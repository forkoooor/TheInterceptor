import { sendPopupMessageToBackgroundPage } from '../../../background/backgroundUtils.js'
import { MessageToPopup, SimulateExecutionReply } from '../../../types/interceptor-messages.js'
import { VisualizedPersonalSignRequestSafeTx } from '../../../types/personal-message-definitions.js'
import { RenameAddressCallBack, RpcConnectionStatus } from '../../../types/user-interface-types.js'
import { ErrorComponent } from '../../subcomponents/Error.js'
import { EditEnsNamedHashCallBack } from '../../subcomponents/ens.js'
import { Transaction } from '../Transactions.js'
import { useEffect, useState } from 'preact/hooks'

type ShowSuccessOrFailureParams = {
	gnosisSafeMessage: VisualizedPersonalSignRequestSafeTx
	currentBlockNumber: undefined | bigint
	rpcConnectionStatus: RpcConnectionStatus
	activeAddress: bigint
	simulateExecutionReply: SimulateExecutionReply | undefined
	renameAddressCallBack: RenameAddressCallBack
	editEnsNamedHashCallBack: EditEnsNamedHashCallBack
}

const requestToSimulate = (gnosisSafeMessage: VisualizedPersonalSignRequestSafeTx) => sendPopupMessageToBackgroundPage({ method: 'popup_simulateGnosisSafeTransaction', data: { gnosisSafeMessage } })


const ShowSuccessOrFailure = ({ simulateExecutionReply, activeAddress, renameAddressCallBack, editEnsNamedHashCallBack, gnosisSafeMessage }: ShowSuccessOrFailureParams) => {
	if (simulateExecutionReply === undefined) {
		return <div style = 'display: flex; justify-content: center;'>
			<button
				class = { 'button is-primary' }
				onClick = { () => requestToSimulate(gnosisSafeMessage) }
				disabled = { false }
			>
				Simulate execution
			</button>
		</div>
	}

	if (simulateExecutionReply.data.success === false) {
		return <div style = 'display: grid; grid-template-rows: max-content' >
			<ErrorComponent text = { simulateExecutionReply.data.errorMessage }/>
		</div>
	}
	console.log(simulateExecutionReply.data.result.simulatedAndVisualizedTransactions)
	const simTx = simulateExecutionReply.data.result.simulatedAndVisualizedTransactions.at(-1)
	if (simTx === undefined) return <></>
	return <div style = 'display: grid; grid-template-rows: max-content' >
		<Transaction
			simTx = { simTx }
			simulationAndVisualisationResults = { {
				blockNumber: simulateExecutionReply.data.result.simulationState.blockNumber,
				blockTimestamp: simulateExecutionReply.data.result.simulationState.blockTimestamp,
				simulationConductedTimestamp: simulateExecutionReply.data.result.simulationState.simulationConductedTimestamp,
				addressBookEntries: simulateExecutionReply.data.result.addressBookEntries,
				rpcNetwork: simulateExecutionReply.data.result.simulationState.rpcNetwork,
				tokenPrices: simulateExecutionReply.data.result.tokenPrices,
				activeAddress: activeAddress,
				simulatedAndVisualizedTransactions: simulateExecutionReply.data.result.simulatedAndVisualizedTransactions,
				visualizedPersonalSignRequests: simulateExecutionReply.data.result.visualizedPersonalSignRequests,
				namedTokenIds: simulateExecutionReply.data.result.namedTokenIds,
			} }
			removeTransactionOrSignedMessage = { undefined }
			activeAddress = { activeAddress }
			renameAddressCallBack = { renameAddressCallBack }
			editEnsNamedHashCallBack = { editEnsNamedHashCallBack }
			addressMetaData = { simulateExecutionReply.data.result.addressBookEntries }
		/>
	</div>
}

type GnosisSafeVisualizerParams = {
	gnosisSafeMessage: VisualizedPersonalSignRequestSafeTx
	activeAddress: bigint
	renameAddressCallBack: RenameAddressCallBack
	editEnsNamedHashCallBack: EditEnsNamedHashCallBack
}

export function GnosisSafeVisualizer(param: GnosisSafeVisualizerParams) {
	const [currentBlockNumber, setCurrentBlockNumber] = useState<undefined | bigint>(undefined)
	const [rpcConnectionStatus, setRpcConnectionStatus] = useState<RpcConnectionStatus>(undefined)
	const [simulateExecutionReply, setSimulateExecutionReply] = useState<SimulateExecutionReply | undefined>(undefined)
	
	const [activeAddress, setActiveAddress] = useState<bigint | undefined>(undefined)

	useEffect(() => {
		const popupMessageListener = async (msg: unknown) => {
			const maybeParsed = MessageToPopup.safeParse(msg)
			if (!maybeParsed.success) return // not a message we are interested in
			const parsed = maybeParsed.value
			if (parsed.method === 'popup_new_block_arrived') {
				setRpcConnectionStatus(parsed.data.rpcConnectionStatus)
				return setCurrentBlockNumber(parsed.data.rpcConnectionStatus?.latestBlock?.number)
			}
			if (parsed.method !== 'popup_simulateExecutionReply') return
			console.log(parsed.method)
			const reply = SimulateExecutionReply.parse(parsed)
			console.log(reply)
			if (reply.data.transactionOrMessageIdentifier !== param.gnosisSafeMessage.messageIdentifier) return
			return setSimulateExecutionReply(reply)
		}
		browser.runtime.onMessage.addListener(popupMessageListener)
		return () => browser.runtime.onMessage.removeListener(popupMessageListener)
	})

	useEffect(() => {
		setActiveAddress(param.activeAddress)
		setSimulateExecutionReply(undefined)
	}, [param.activeAddress, param.gnosisSafeMessage.messageIdentifier])

	if (activeAddress === undefined) return <></>
	return <>
		<div style = 'display: grid; grid-template-rows: max-content max-content'>
			<span class = 'log-table' style = 'padding-bottom: 10px; grid-template-columns: auto auto;'>
				<div class = 'log-cell'>
					<p class = 'paragraph'>Simulation of this transaction should the multisig approve the transaction:</p>
				</div>
				<div class = 'log-cell' style = 'justify-content: right;'>
					{ simulateExecutionReply === undefined ? <></> :
						<button class = { 'button is-primary is-small' } onClick = { () => requestToSimulate(param.gnosisSafeMessage) }>Refresh</button>
					}
				</div>
			</span>
		</div>
		<div class = 'notification dashed-notification'>
			<ShowSuccessOrFailure
				gnosisSafeMessage = { param.gnosisSafeMessage }
				currentBlockNumber = { currentBlockNumber }
				rpcConnectionStatus = { rpcConnectionStatus }
				simulateExecutionReply = { simulateExecutionReply }
				renameAddressCallBack = { param.renameAddressCallBack }
				editEnsNamedHashCallBack = { param.editEnsNamedHashCallBack }
				activeAddress = { activeAddress }
			/>
		</div>
	</>
}
