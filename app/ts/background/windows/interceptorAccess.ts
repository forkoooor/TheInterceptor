import { PopupOrTab, addWindowTabListener, closePopupOrTab, getPopupOrTabOnlyById, openPopupOrTab, removeWindowTabListener } from '../../components/ui-utils.js'
import { Future } from '../../utils/future.js'
import { ExternalPopupMessage, InterceptedRequest, InterceptorAccessChangeAddress, InterceptorAccessRefresh, InterceptorAccessReply, PendingAccessRequestArray, Settings, WebsiteAccessArray, WindowMessage } from '../../utils/interceptor-messages.js'
import { Semaphore } from '../../utils/semaphore.js'
import { AddressInfo, AddressInfoEntry, Website, WebsiteSocket, WebsiteTabConnections } from '../../utils/user-interface-types.js'
import { getAssociatedAddresses, setAccess, updateWebsiteApprovalAccesses } from '../accessManagement.js'
import { changeActiveAddressAndChainAndResetSimulation, handleContentScriptMessage, postMessageIfStillConnected, refuseAccess } from '../background.js'
import { INTERNAL_CHANNEL_NAME, createInternalMessageListener, getHtmlFile, sendPopupMessageToOpenWindows, websiteSocketToString } from '../backgroundUtils.js'
import { findAddressInfo } from '../metadataUtils.js'
import { getSignerName, getTabState, getSettings, updatePendingAccessRequests, getPendingAccessRequests, clearPendingAccessRequests } from '../settings.js'

let openedDialog: PopupOrTab | undefined = undefined

const pendingInterceptorAccess = new Map<number, Future<InterceptorAccessReply>>()
const pendingInterceptorAccessSemaphore = new Semaphore(1)

const onCloseWindow = async (windowId: number, websiteTabConnections: WebsiteTabConnections) => { // check if user has closed the window on their own, if so, reject signature
	if (openedDialog?.windowOrTab.id !== windowId) return
	const pendingRequests = await clearPendingAccessRequests()
	pendingRequests.forEach((pending) => {
		const reply = {
			originalRequestAccessToAddress: pending.originalRequestAccessToAddress?.address,
			requestAccessToAddress: pending.requestAccessToAddress?.address,
			requestId: pending.requestId,
			userReply: 'NoResponse' as const
		}
		resolveInterceptorAccess(websiteTabConnections, reply)
	})
	pendingInterceptorAccess.clear()
	openedDialog = undefined
}

async function updateViewOrClose() {
	const promises = await getPendingAccessRequests()
	if (promises.length >= 1) {
		return sendPopupMessageToOpenWindows({ method: 'popup_update_access_dialog', data: promises })
	}
	if (openedDialog) closePopupOrTab(openedDialog)
	openedDialog = undefined
}

export async function resolveInterceptorAccess(websiteTabConnections: WebsiteTabConnections, reply: InterceptorAccessReply) {
	const promises = await getPendingAccessRequests()
	const pendingRequest = promises.find((req) => req.requestId === reply.requestId)
	if (pendingRequest == undefined) return
	
	const future = pendingInterceptorAccess.get(reply.requestId)
	if (future === undefined) return resolve(websiteTabConnections, reply, pendingRequest.socket, undefined, pendingRequest.website)
	return future.resolve(reply)
}

export function getAddressMetadataForAccess(websiteAccess: WebsiteAccessArray, addressInfos: readonly AddressInfo[]): AddressInfoEntry[] {
	const addresses = websiteAccess.map((x) => x.addressAccess === undefined ? [] : x.addressAccess?.map((addr) => addr.address)).flat()
	const addressSet = new Set(addresses)
	return Array.from(addressSet).map((x) => findAddressInfo(x, addressInfos))
}

export async function removePendingAccessRequest(websiteOrigin: string, requestAccessToAddress: bigint | undefined) {
	await updatePendingAccessRequests(async (previousPendingAccessRequests) => {
		return previousPendingAccessRequests.filter((x) => !(x.website.websiteOrigin === websiteOrigin && x.requestAccessToAddress?.address === requestAccessToAddress))
	})
}

export async function changeAccess(websiteTabConnections: WebsiteTabConnections, confirmation: InterceptorAccessReply, website: Website, promptForAccessesIfNeeded: boolean = true) {
	if (confirmation.userReply === 'NoResponse') return
	await setAccess(website, confirmation.userReply === 'Approved', confirmation.requestAccessToAddress)
	updateWebsiteApprovalAccesses(websiteTabConnections, promptForAccessesIfNeeded, await getSettings())
	await removePendingAccessRequest(website.websiteOrigin, confirmation.requestAccessToAddress)
	await sendPopupMessageToOpenWindows({ method: 'popup_websiteAccess_changed' })
}

async function askForSignerAccountsFromSignerIfNotAvailable(websiteTabConnections: WebsiteTabConnections, socket: WebsiteSocket) {
	const tabState = await getTabState(socket.tabId)
	if (tabState.signerAccounts.length !== 0) return tabState.signerAccounts

	const future = new Future<void>
	const listener = createInternalMessageListener( (message: WindowMessage) => {
		if (message.method === 'window_signer_accounts_changed' && websiteSocketToString(message.data.socket) === websiteSocketToString(socket)) return future.resolve()
	})
	const channel = new BroadcastChannel(INTERNAL_CHANNEL_NAME)
	try {
		channel.addEventListener('message', listener)
		const messageSent = postMessageIfStillConnected(websiteTabConnections, socket, {
			interceptorApproved: true,
			options: { method: 'request_signer_to_eth_requestAccounts' },
			result: []
		})
		if (messageSent) await future
	} finally {
		channel.removeEventListener('message', listener)
		channel.close()
	}
	return (await getTabState(socket.tabId)).signerAccounts
}

export async function requestAccessFromUser(
	websiteTabConnections: WebsiteTabConnections,
	socket: WebsiteSocket,
	website: Website,
	request: InterceptedRequest | undefined,
	requestAccessToAddress: AddressInfoEntry | undefined,
	settings: Settings,
) {
	let justAddToPending = false
	if (pendingInterceptorAccess.size !== 0) justAddToPending = true
	
	// check if we need to ask address access or not. If address is put to never need to have address specific permision, we don't need to ask for it
	const askForAddressAccess = requestAccessToAddress !== undefined && settings.userAddressBook.addressInfos.find((x) => x.address === requestAccessToAddress.address)?.askForAddressAccess !== false
	const accessAddress = askForAddressAccess ? requestAccessToAddress : undefined
	const future = new Future<InterceptorAccessReply>()
	const requestId = request === undefined ? -Math.random() : request.requestId // if there's no particular request requesting this access, generate random ID for it
	pendingInterceptorAccess.set(requestId, future)

	const closeWindowCallback = (windowId: number) => onCloseWindow(windowId, websiteTabConnections) 

	const pendingAccessRequests = new Future<PendingAccessRequestArray>()

	const windowReadyAndListening = async function popupMessageListener(msg: unknown) {
		const message = ExternalPopupMessage.parse(msg)
		if (message.method !== 'popup_interceptorAccessReadyAndListening') return
		browser.runtime.onMessage.removeListener(windowReadyAndListening)
		return await sendPopupMessageToOpenWindows({
			method: 'popup_interceptorAccessDialog',
			data: await pendingAccessRequests
		})
	}

	try {
		const addedPending = await pendingInterceptorAccessSemaphore.execute(async () => {
			if (!justAddToPending) {
				const oldPromise = await getPendingAccessRequests()
				if (oldPromise.length !== 0) {
					if (await getPopupOrTabOnlyById(oldPromise[0].dialogId) !== undefined) {
						justAddToPending = true
					} else {
						await clearPendingAccessRequests()
					}
				}
			}
	
			if (!justAddToPending) {
				browser.runtime.onMessage.addListener(windowReadyAndListening)
				addWindowTabListener(closeWindowCallback)
				openedDialog = await openPopupOrTab({
					url: getHtmlFile('interceptorAccess'),
					type: 'popup',
					height: 800,
					width: 600,
				})
			}
	
			if (openedDialog?.windowOrTab.id === undefined) return false
			
			const pendingRequest = {
				dialogId: openedDialog?.windowOrTab.id,
				socket,
				requestId,
				website,
				requestAccessToAddress: accessAddress,
				originalRequestAccessToAddress: accessAddress,
				associatedAddresses: requestAccessToAddress !== undefined ? getAssociatedAddresses(settings, website.websiteOrigin, requestAccessToAddress) : [],
				addressInfos: settings.userAddressBook.addressInfos,
				signerAccounts: [],
				signerName: await getSignerName(),
				simulationMode: settings.simulationMode,
			}

			const requests = await updatePendingAccessRequests(async (previousPendingAccessRequests) => {
				if (previousPendingAccessRequests.find((x) => x.website.websiteOrigin === pendingRequest.website.websiteOrigin && x.requestAccessToAddress?.address === pendingRequest.requestAccessToAddress?.address) === undefined) {
					return previousPendingAccessRequests.concat(pendingRequest)
				}
				return previousPendingAccessRequests
			})

			if (justAddToPending) return await sendPopupMessageToOpenWindows({ method: 'popup_popup_interceptor_access_dialog_pending_changed', data: requests })
			pendingAccessRequests.resolve(requests)
			return true
		})
		if (addedPending === false) {
			if (request !== undefined) refuseAccess(websiteTabConnections, socket, request)
			return
		}
		const reply = await future
		return await resolve(websiteTabConnections, reply, socket, request, website)
	} finally {
		browser.runtime.onMessage.removeListener(windowReadyAndListening)
		removeWindowTabListener(closeWindowCallback)
		pendingInterceptorAccess.delete(requestId)
		await updateViewOrClose()
	}
}

async function resolve(websiteTabConnections: WebsiteTabConnections, accessReply: InterceptorAccessReply, socket: WebsiteSocket, request: InterceptedRequest | undefined, website: Website) {
	if (accessReply.userReply === 'NoResponse') {
		if (request !== undefined) refuseAccess(websiteTabConnections, socket, request)
		return
	}

	const userRequestedAddressChange = accessReply.requestAccessToAddress !== accessReply.originalRequestAccessToAddress

	if (!userRequestedAddressChange) {
		await changeAccess(websiteTabConnections, accessReply, website)
		if (request !== undefined) await handleContentScriptMessage(websiteTabConnections, socket, request, website)
		return
	} else {
		if (accessReply.requestAccessToAddress === undefined) throw new Error('Changed request to page level')

		// clear the original pending request, which was made with other account
		await removePendingAccessRequest(website.websiteOrigin, accessReply.requestAccessToAddress)

		await changeAccess(websiteTabConnections, accessReply, website, false)
		const settings = await getSettings()
		await changeActiveAddressAndChainAndResetSimulation(websiteTabConnections, {
			simulationMode: settings.simulationMode,
			activeAddress: accessReply.requestAccessToAddress,
		})
	}
}

export async function requestAddressChange(websiteTabConnections: WebsiteTabConnections, message: InterceptorAccessChangeAddress | InterceptorAccessRefresh) {
	const newRequests = await updatePendingAccessRequests(async (previousPendingAccessRequests) => {
		if (message.options.requestAccessToAddress === undefined) throw new Error('Requesting account change on site level access request')
		async function getProposedAddress() {
			if (message.method === 'popup_interceptorAccessRefresh' || message.options.newActiveAddress === 'signer') {
				const signerAccounts = await askForSignerAccountsFromSignerIfNotAvailable(websiteTabConnections, message.options.socket)
				return signerAccounts === undefined || signerAccounts.length == 0 ? undefined : signerAccounts[0]
			}
			return message.options.newActiveAddress
		}

		const proposedAddress = await getProposedAddress()
		const settings = await getSettings()
		const newActiveAddress = proposedAddress === undefined ? message.options.requestAccessToAddress : proposedAddress
		const newActiveAddressAddressInfo = findAddressInfo(newActiveAddress, settings.userAddressBook.addressInfos)
		const associatedAddresses = getAssociatedAddresses(settings, message.options.website.websiteOrigin, newActiveAddressAddressInfo)
		
		return previousPendingAccessRequests.map((request) => {
			if (request.requestId === message.options.requestId) {
				return {
					...request,
					associatedAddresses,
					requestAccessTo: newActiveAddress
				}
			}
			return request
		})
	})
	return await sendPopupMessageToOpenWindows({
		method: 'popup_interceptorAccessDialog',
		data: newRequests,
	})
}

export async function interceptorAccessMetadataRefresh() {
	const settings = await getSettings()
	const signerName = await getSignerName()
	return await sendPopupMessageToOpenWindows({
		method: 'popup_interceptorAccessDialog',
		data: (await getPendingAccessRequests()).map((request) => {
			const requestAccessTo = request.requestAccessToAddress === undefined ? undefined : findAddressInfo(request.requestAccessToAddress?.address, settings.userAddressBook.addressInfos)
			const associatedAddresses = getAssociatedAddresses(settings, request.website.websiteOrigin, requestAccessTo)
			return {
				...request,
				associatedAddresses,
				signerName: signerName,
				requestAccessTo
			}
		})
	})
}
