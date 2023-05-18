import { PopupOrTab, addWindowTabListener, openPopupOrTab, removeWindowTabListener } from '../../components/ui-utils.js'
import { METAMASK_ERROR_USER_REJECTED_REQUEST } from '../../utils/constants.js'
import { Future } from '../../utils/future.js'
import { ChainChangeConfirmation, InterceptedRequest, ExternalPopupMessage, SignerChainChangeConfirmation } from '../../utils/interceptor-messages.js'
import { Website, WebsiteSocket, WebsiteTabConnections } from '../../utils/user-interface-types.js'
import { changeActiveChain, sendMessageToContentScript } from '../background.js'
import { getHtmlFile, sendPopupMessageToOpenWindows } from '../backgroundUtils.js'
import { getChainChangeConfirmationPromise, setChainChangeConfirmationPromise } from '../settings.js'

let pendForUserReply: Future<ChainChangeConfirmation> | undefined = undefined
let pendForSignerReply: Future<SignerChainChangeConfirmation> | undefined = undefined

let openedDialog: PopupOrTab | undefined = undefined

export async function resolveChainChange(websiteTabConnections: WebsiteTabConnections, confirmation: ChainChangeConfirmation) {
	if (pendForUserReply !== undefined) {
		pendForUserReply.resolve(confirmation)
		return
	}
	const data = await getChainChangeConfirmationPromise()
	if (data === undefined || confirmation.options.requestId !== data.request.requestId) return
	const resolved = await resolve(websiteTabConnections, confirmation, data.simulationMode)
	sendMessageToContentScript(websiteTabConnections, data.socket, resolved, data.request)
}

export async function resolveSignerChainChange(confirmation: SignerChainChangeConfirmation) {
	if (pendForSignerReply !== undefined) pendForSignerReply.resolve(confirmation)
	pendForSignerReply = undefined
}

function rejectMessage(requestId: number) {
	return {
		method: 'popup_changeChainDialog',
		options: {
			requestId,
			accept: false,
		},
	} as const
}

const userDeniedChange = {
	error: {
		code: METAMASK_ERROR_USER_REJECTED_REQUEST,
		message: 'User denied the chain change.',
	}
} as const

export const openChangeChainDialog = async (
	websiteTabConnections: WebsiteTabConnections,
	socket: WebsiteSocket,
	request: InterceptedRequest,
	simulationMode: boolean,
	website: Website,
	chainId: bigint
) => {
	if (openedDialog !== undefined || pendForUserReply || pendForSignerReply) return userDeniedChange

	pendForUserReply = new Future<ChainChangeConfirmation>()

	const onCloseWindow = (windowId: number) => { // check if user has closed the window on their own, if so, reject signature
		if (openedDialog === undefined || openedDialog.windowOrTab.id !== windowId) return
		openedDialog = undefined
		if (pendForUserReply === undefined) return
		resolveChainChange(websiteTabConnections, rejectMessage(request.requestId))
	}

	const changeChainWindowReadyAndListening = async function popupMessageListener(msg: unknown) {
		const message = ExternalPopupMessage.parse(msg)
		if ( message.method !== 'popup_changeChainReadyAndListening') return
		browser.runtime.onMessage.removeListener(changeChainWindowReadyAndListening)
		return sendPopupMessageToOpenWindows({
			method: 'popup_ChangeChainRequest',
			data: {
				requestId: request.requestId,
				chainId: chainId,
				website: website,
				simulationMode: simulationMode,
			}
		})
	}

	try {
		const oldPromise = await getChainChangeConfirmationPromise()
		if (oldPromise !== undefined) {
			if ((await browser.tabs.query({ windowId: oldPromise.dialogId })).length > 0) {
				return userDeniedChange
			} else {
				await setChainChangeConfirmationPromise(undefined)
			}
		}

		browser.runtime.onMessage.addListener(changeChainWindowReadyAndListening)

		openedDialog = await openPopupOrTab({
			url: getHtmlFile('changeChain'),
			type: 'popup',
			height: 450,
			width: 520,
		})

		if (openedDialog?.windowOrTab.id !== undefined) {
			addWindowTabListener(onCloseWindow)

			setChainChangeConfirmationPromise({
				website: website,
				dialogId: openedDialog?.windowOrTab.id,
				socket: socket,
				request: request,
				simulationMode: simulationMode,
			})
		} else {
			resolveChainChange(websiteTabConnections, rejectMessage(request.requestId))
		}
		pendForSignerReply = undefined

		const reply = await pendForUserReply

		// forward message to content script
		return resolve(websiteTabConnections, reply, simulationMode)
	} finally {
		removeWindowTabListener(onCloseWindow)
		browser.runtime.onMessage.removeListener(changeChainWindowReadyAndListening)
		pendForUserReply = undefined
		openedDialog = undefined
	}
}

async function resolve(websiteTabConnections: WebsiteTabConnections, reply: ChainChangeConfirmation, simulationMode: boolean) {
	await setChainChangeConfirmationPromise(undefined)
	if (reply.options.accept) {
		if (simulationMode) {
			await changeActiveChain(websiteTabConnections, reply.options.chainId, simulationMode)
			return { result: null }
		}
		pendForSignerReply = new Future<SignerChainChangeConfirmation>() // when not in simulation mode, we need to get reply from the signer too
		await changeActiveChain(websiteTabConnections, reply.options.chainId, simulationMode)
		const signerReply = await pendForSignerReply
		if (signerReply.options.accept && signerReply.options.chainId === reply.options.chainId) {
			return { result: null }
		}
	}
	return userDeniedChange
}
