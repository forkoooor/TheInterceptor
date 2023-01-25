import { useState, useEffect } from 'preact/hooks'
import { defaultAddresses, WebsiteAccess } from '../background/settings.js'
import { addressString } from '../utils/bigint.js'
import { EthBalanceChangesWithMetadata, SimulatedAndVisualizedTransaction, SimulationAndVisualisationResults, TokenVisualizerResultWithMetadata } from '../utils/visualizer-types.js'
import { AddressList } from './pages/AddressList.js'
import { ChangeActiveAddress } from './pages/ChangeActiveAddress.js'
import { Home } from './pages/Home.js'
import { Page, AddressInfo, TabConnection, AddressInfoEntry, AddressBookEntry } from '../utils/user-interface-types.js'
import Hint from './subcomponents/Hint.js'
import { AddNewAddress } from './pages/AddNewAddress.js'
import { InterceptorAccessList } from './pages/InterceptorAccessList.js'
import { ethers } from 'ethers'
import { PasteCatcher } from './subcomponents/PasteCatcher.js'
import { truncateAddr } from '../utils/ethereum.js'
import { NotificationCenter } from './pages/NotificationCenter.js'
import { DEFAULT_TAB_CONNECTION } from '../utils/constants.js'
import { SignerName } from '../utils/interceptor-messages.js'
import { EthereumQuantity } from '../utils/wire-types.js'
import { version, gitCommitSha } from '../version.js'

export function App() {
	const [appPage, setAppPage] = useState(Page.Home)
	const [makeMeRich, setMakeMeRich] = useState(false)
	const [addressInfos, setAddressInfos] = useState<readonly AddressInfo[]>(defaultAddresses)
	const [signerAccounts, setSignerAccounts] = useState<readonly bigint[] | undefined>(undefined)
	const [activeSimulationAddress, setActiveSimulationAddress] = useState<bigint | undefined>(undefined)
	const [activeSigningAddress, setActiveSigningAddress] = useState<bigint | undefined>(undefined)
	const [useSignersAddressAsActiveAddress, setUseSignersAddressAsActiveAddress] = useState(false)
	const [simVisResults, setSimVisResults] = useState<SimulationAndVisualisationResults | undefined >(undefined)
	const [websiteAccess, setWebsiteAccess] = useState<readonly WebsiteAccess[] | undefined>(undefined)
	const [websiteAccessAddressMetadata, setWebsiteAccessAddressMetadata] = useState<[string, AddressInfoEntry][]>([])
	const [activeChain, setActiveChain] = useState<bigint>(1n)
	const [addressInput, setAddressInput] = useState<string | undefined>(undefined)
	const [nameInput, setNameInput] = useState<string | undefined>(undefined)
	const [simulationMode, setSimulationMode] = useState<boolean>(true)
	const [notificationBadgeCount, setNotificationBadgeCount] = useState<number>(0)
	const [tabConnection, setTabConnection] = useState<TabConnection>(DEFAULT_TAB_CONNECTION)
	const [tabApproved, setTabApproved] = useState<boolean>(false)
	const [isSettingsLoaded, setIsSettingsLoaded] = useState<boolean>(false)
	const [currentBlockNumber, setCurrentBlockNumber] = useState<bigint | undefined>(undefined)
	const [signerName, setSignerName] = useState<SignerName | undefined>(undefined)

	function fetchSettings(backgroundPage: Window) {
		const settings = backgroundPage.interceptor.settings
		if ( settings === undefined ) throw `failed to fetch settings`
		setActiveSimulationAddress(settings.activeSimulationAddress)
		setActiveSigningAddress(settings.activeSigningAddress)
		setUseSignersAddressAsActiveAddress(settings.useSignersAddressAsActiveAddress)
		setAddressInfos(settings.addressInfos)
		setAppPage(settings.page)
		setMakeMeRich(settings.makeMeRich)
		setWebsiteAccess(settings.websiteAccess)
		setWebsiteAccessAddressMetadata(backgroundPage.interceptor.websiteAccessAddressMetadata)
		setActiveChain(settings.activeChain)
		setSimulationMode(settings.simulationMode !== undefined ? settings.simulationMode : true)
		setNotificationBadgeCount(settings.pendingAccessRequests.length)
	}

	async function setActiveAddressAndInformAboutIt(address: bigint | 'signer') {
		setUseSignersAddressAsActiveAddress(address === 'signer')
		if( address === 'signer' ) {
			browser.runtime.sendMessage( { method: 'popup_changeActiveAddress', options: 'signer' } );
			if(simulationMode) {
				return setActiveSimulationAddress(signerAccounts && signerAccounts.length > 0 ? signerAccounts[0] : undefined)
			}
			return setActiveSigningAddress(signerAccounts && signerAccounts.length > 0 ? signerAccounts[0] : undefined)
		}
		browser.runtime.sendMessage( { method: 'popup_changeActiveAddress', options: addressString(address) } );
		if(simulationMode) {
			return setActiveSimulationAddress(address)
		}
		return setActiveSigningAddress(address)
	}

	function isSignerConnected() {
		return signerAccounts !== undefined && signerAccounts.length > 0
			&& (
				simulationMode && activeSimulationAddress !== undefined && signerAccounts[0] === activeSimulationAddress
				|| !simulationMode && activeSigningAddress !== undefined && signerAccounts[0] === activeSigningAddress
			)
	}

	async function setActiveChainAndInformAboutIt(chainId: bigint) {
		browser.runtime.sendMessage( { method: 'popup_changeActiveChain', options: EthereumQuantity.serialize(chainId) } );
		if(!isSignerConnected()) {
			setActiveChain(chainId)
		}
	}

	function fetchSimulationState(backgroundPage: Window) {
		const simState = backgroundPage.interceptor.simulation.simulationState
		if (simState === undefined) return setSimVisResults(undefined)
		if (backgroundPage.interceptor.settings?.activeSimulationAddress === undefined) return setSimVisResults(undefined)

		const addressMetadata = new Map(backgroundPage.interceptor.simulation.addressBookEntries.map( (x) => [x[0], x[1]]))

		// todo, move this to background page (and refacor hard) to form when simulation is made and we can get rid of most of the validations done here
		const txs: SimulatedAndVisualizedTransaction[] = simState.simulatedTransactions.map( (simulatedTx, index) => {
			const from = addressMetadata.get(addressString(simulatedTx.unsignedTransaction.from))
			if (from === undefined) throw new Error('missing metadata')

			const to = simulatedTx.unsignedTransaction.to !== null ? addressMetadata.get(addressString(simulatedTx.unsignedTransaction.to)) : undefined
			if (simulatedTx.unsignedTransaction.to !== null && to === undefined ) throw new Error('missing metadata')

			if (backgroundPage.interceptor.simulation.visualizerResults === undefined) throw new Error('missing visualizerResults')
			const visualiser = backgroundPage.interceptor.simulation.visualizerResults[index].visualizerResults

			const ethBalanceChanges: EthBalanceChangesWithMetadata[] = visualiser === undefined ? [] : visualiser.ethBalanceChanges.map((change) => {
				const entry = addressMetadata.get(addressString(change.address))
				if (entry === undefined) throw new Error('missing metadata')
				return {
					...change,
					address: entry,
				}
			})
			const tokenResults: TokenVisualizerResultWithMetadata[] = visualiser === undefined ? [] : visualiser.tokenResults.map((change) => {
				const fromEntry = addressMetadata.get(addressString(change.from))
				const toEntry = addressMetadata.get(addressString(change.to))
				const tokenEntry = addressMetadata.get(addressString(change.tokenAddress))
				if (fromEntry === undefined || toEntry === undefined || tokenEntry === undefined) throw new Error('missing metadata')
				if ( !(change.is721 && tokenEntry.type === 'NFT') ) throw new Error('wrong tokentype')
				return {
					...change,
					from: fromEntry,
					to: toEntry,
					token: tokenEntry,
				}
			})
			return {
				from: from,
				to: to,
				value: simulatedTx.unsignedTransaction.value,
				realizedGasPrice: simulatedTx.realizedGasPrice,
				ethBalanceChanges: ethBalanceChanges,
				tokenResults: tokenResults,
				gasSpent: simulatedTx.multicallResponse.gasSpent,
				quarantine: backgroundPage.interceptor.simulation.visualizerResults[index].quarantine,
				quarantineCodes: backgroundPage.interceptor.simulation.visualizerResults[index].quarantineCodes,
				chainId: simState.chain,
				gas: simulatedTx.unsignedTransaction.gas,
				input: simulatedTx.unsignedTransaction.input,
				...(simulatedTx.unsignedTransaction.type === '1559' ? {
					type: simulatedTx.unsignedTransaction.type,
					maxFeePerGas: simulatedTx.unsignedTransaction.maxFeePerGas,
					maxPriorityFeePerGas: simulatedTx.unsignedTransaction.maxPriorityFeePerGas,
				} : { type: simulatedTx.unsignedTransaction.type } ),
				hash: simulatedTx.signedTransaction.hash,
				...(simulatedTx.multicallResponse.statusCode === 'failure' ? {
					error: simulatedTx.multicallResponse.error,
					statusCode: simulatedTx.multicallResponse.statusCode,
				} : {
					statusCode: simulatedTx.multicallResponse.statusCode,
				}),
			}
		} )

		setSimVisResults( {
			blockNumber: simState.blockNumber,
			blockTimestamp: simState.blockTimestamp,
			simulationConductedTimestamp: simState.simulationConductedTimestamp,
			simulatedAndVisualizedTransactions: txs,
			chain: simState.chain,
			tokenPrices: backgroundPage.interceptor.simulation.tokenPrices,
			activeAddress: BigInt(backgroundPage.interceptor.settings.activeSimulationAddress),
			simulationMode: backgroundPage.interceptor.settings.simulationMode,
			isComputingSimulation: backgroundPage.interceptor.simulation.isComputingSimulation,
		})
	}

	async function updateState() {
		const backgroundPage = await browser.runtime.getBackgroundPage()
		fetchSettings(backgroundPage)
		fetchSimulationState(backgroundPage)
		setSignerName(backgroundPage.interceptor.signerName)
		setTabConnection( DEFAULT_TAB_CONNECTION )
		setCurrentBlockNumber(backgroundPage.interceptor.currentBlockNumber)
		const tabs = await browser.tabs.query({ active: true, currentWindow: true })
		if (tabs.length === 0 || tabs[0].id === undefined ) return
		const signerState = backgroundPage.interceptor.websiteTabSignerStates.get(tabs[0].id)
		if (signerState) setSignerAccounts(signerState.signerAccounts)
		const conn = backgroundPage.interceptor.websiteTabConnection.get(tabs[0].id)
		if ( conn ) setTabConnection(conn)
		setTabApproved(backgroundPage.interceptor.websiteTabApprovals.get(tabs[0].id)?.approved === true)
		setIsSettingsLoaded(true)
	}

	useEffect(  () => {
		updateState()

		async function popupMessageListener(msg: unknown) {
			console.log('popup message')
			console.log(msg)
			updateState()
		}

		browser.runtime.onMessage.addListener(popupMessageListener)

		return () => {
			browser.runtime.onMessage.removeListener(popupMessageListener)
		}
	}, [])

	function setAndSaveAppPage(page: Page) {
		setAppPage(page)
		browser.runtime.sendMessage( { method: 'popup_changePage', options: page } );
	}

	async function addressPaste(address: string) {
		if (appPage === Page.AddNewAddress) return

		const trimmed = address.trim()
		if ( !ethers.utils.isAddress(trimmed) ) return

		const integerRepresentatio = BigInt(trimmed)
		// see if we have that address, if so, let's switch to it
		for (const addressInfo of addressInfos) {
			if ( addressInfo.address === integerRepresentatio) {
				return await setActiveAddressAndInformAboutIt(addressInfo.address)
			}
		}

		// address not found, let's promt user to create it
		const addressString = ethers.utils.getAddress(trimmed)
		setAndSaveAppPage(Page.AddNewAddress)
		setNameInput(`Pasted ${ truncateAddr(addressString) }`)
		setAddressInput(addressString)
	}

	function renameAddressCallBack(entry: AddressBookEntry) {
		setAndSaveAppPage(Page.ModifyAddress)
		setNameInput(entry.name === undefined ? '' : entry.name)
		setAddressInput(ethers.utils.getAddress(addressString(entry.address)))
	}

	function openAddressBook() {
		browser.tabs.create({ url: '../html/addressBook.html' })
	}

	return (
		<main style = { `background-color: var(--bg-color); width: 520px; height: 600px; ${ appPage !== Page.Home ? 'overflow: hidden;' : 'overflow: auto;' }` }>
			<PasteCatcher enabled = { appPage === Page.Home } onPaste = { addressPaste } />
			{ !isSettingsLoaded ? <></> : <>
				<Hint>
					<nav class = 'navbar window-header' role = 'navigation' aria-label = 'main navigation'>
						<div class = 'navbar-brand'>
							<a class = 'navbar-item' style = 'cursor: unset'>
								<img src = '../img/LOGOA.svg' alt = 'Logo' width = '32'/>
								<p style = 'color: #FFFFFF; padding-left: 5px;'>THE INTERCEPTOR
									<span style = 'color: var(--unimportant-text-color);' > { ` alpha ${ version } - ${ gitCommitSha.slice(0, 8) }`  } </span>
								</p>
							</a>
							<a class = 'navbar-item' style = 'margin-left: auto; margin-right: 0;'>
								<img src = '../img/internet.svg' width = '32' onClick = { () => setAndSaveAppPage(Page.AccessList) }/>
								<img src = '../img/my-accounts.svg' width = '32' onClick = { () => setAndSaveAppPage(Page.AddressList) }/>
								<img src = '../img/address-book.svg' width = '32' onClick = { openAddressBook }/>
								<div>
									<img src = '../img/notification-bell.svg' width = '32' onClick = { () => setAndSaveAppPage(Page.NotificationCenter) }/>
									{ notificationBadgeCount <= 0 ? <> </> : <span class = 'badge' style = 'transform: translate(-75%, 75%);'> { notificationBadgeCount } </span> }
								</div>
							</a>
						</div>
					</nav>
					<Home
						setActiveChainAndInformAboutIt = { setActiveChainAndInformAboutIt }
						activeChain = { activeChain }
						simVisResults = { simVisResults }
						useSignersAddressAsActiveAddress = { useSignersAddressAsActiveAddress }
						activeSigningAddress = { activeSigningAddress }
						activeSimulationAddress = { activeSimulationAddress }
						signerAccounts = { signerAccounts }
						setAndSaveAppPage = { setAndSaveAppPage }
						makeMeRich = { makeMeRich }
						addressInfos = { addressInfos }
						simulationMode = { simulationMode }
						tabConnection = { tabConnection }
						tabApproved = { tabApproved }
						currentBlockNumber = { currentBlockNumber }
						signerName = { signerName }
						renameAddressCallBack = { renameAddressCallBack }
					/>

					<div class = { `modal ${ appPage !== Page.Home ? 'is-active' : ''}` }>
						{ appPage === Page.NotificationCenter ?
							<NotificationCenter
								setAndSaveAppPage = { setAndSaveAppPage }
								renameAddressCallBack = { renameAddressCallBack }
							/>
						: <></> }
						{ appPage === Page.AccessList ?
							<InterceptorAccessList
								setAndSaveAppPage = { setAndSaveAppPage }
								setWebsiteAccess = { setWebsiteAccess }
								websiteAccess = { websiteAccess }
								websiteAccessAddressMetadata = { websiteAccessAddressMetadata }
								renameAddressCallBack = { renameAddressCallBack }
							/>
						: <></> }
						{ appPage === Page.AddressList ?
							<AddressList
								setAddressInfos = { setAddressInfos }
								setAndSaveAppPage = { setAndSaveAppPage }
								addressInfos = { addressInfos }
							/>
						: <></> }
						{ appPage === Page.ChangeActiveAddress ?
							<ChangeActiveAddress
								setActiveAddressAndInformAboutIt = { setActiveAddressAndInformAboutIt }
								signerAccounts = { signerAccounts }
								setAndSaveAppPage = { setAndSaveAppPage }
								addressInfos = { addressInfos }
								signerName = { signerName }
								renameAddressCallBack = { renameAddressCallBack }
							/>
						: <></> }
						{ appPage === Page.AddNewAddress || appPage === Page.ModifyAddress ?
							<AddNewAddress
								setActiveAddressAndInformAboutIt = { setActiveAddressAndInformAboutIt }
								addressInput = { addressInput }
								nameInput = { nameInput }
								addingNewAddress = { appPage === Page.AddNewAddress }
								setAddressInput = { setAddressInput }
								setNameInput = { setNameInput }
								close = { () => setAndSaveAppPage(Page.Home) }
								activeAddress = { simulationMode ? activeSimulationAddress : activeSigningAddress }
							/>
						: <></> }
					</div>

				</Hint>
			</> }
		</main>
	)
}
