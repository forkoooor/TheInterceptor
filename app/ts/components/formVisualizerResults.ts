import { addressString } from '../utils/bigint.js'
import { EthBalanceChangesWithMetadata, NamedTokenId, ProtectorResults, SimulatedAndVisualizedTransaction, SimulationState, TokenVisualizerResultWithMetadata, VisualizerResult } from '../types/visualizer-types.js'
import { AddressBookEntry } from '../types/addressBookTypes.js'
import { getArtificialERC20ForEth } from './ui-utils.js'

export function formSimulatedAndVisualizedTransaction(simState: SimulationState, visualizerResults: readonly VisualizerResult[], protectorResults: readonly ProtectorResults[], addressBookEntries: readonly AddressBookEntry[], namedTokenIds: readonly NamedTokenId[]): readonly SimulatedAndVisualizedTransaction[] {
	const addressMetaData = new Map(addressBookEntries.map((x) => [addressString(x.address), x]))
	return simState.simulatedTransactions.map((simulatedTx, index) => {
		const from = addressMetaData.get(addressString(simulatedTx.signedTransaction.from))
		if (from === undefined) throw new Error('missing metadata')

		const to = simulatedTx.signedTransaction.to !== null ? addressMetaData.get(addressString(simulatedTx.signedTransaction.to)) : undefined
		if (simulatedTx.signedTransaction.to !== null && to === undefined) throw new Error('missing metadata')
		const visualizerResult = visualizerResults[index]
		if (visualizerResult === undefined) throw new Error('visualizer result was undefined')
		const protectorResult = protectorResults[index]
		if (protectorResult === undefined) throw new Error('protecor result was undefined')

		const ethBalanceChanges: EthBalanceChangesWithMetadata[] = visualizerResult === undefined ? [] : visualizerResult.ethBalanceChanges.map((change) => {
			const entry = addressMetaData.get(addressString(change.address))
			if (entry === undefined) throw new Error('missing metadata')
			return {
				...change,
				address: entry,
			}
		})
		const tokenResults: TokenVisualizerResultWithMetadata[] = visualizerResult === undefined ? [] : visualizerResult.tokenResults.map((change): TokenVisualizerResultWithMetadata | undefined => {
			const fromEntry = addressMetaData.get(addressString(change.from))
			const toEntry = addressMetaData.get(addressString(change.to))
			const tokenEntry = addressMetaData.get(addressString(change.tokenAddress))
			if (fromEntry === undefined || toEntry === undefined || tokenEntry === undefined) throw new Error('missing metadata')
			if ((change.type === 'ERC721' && tokenEntry.type === 'ERC721')) {
				return {
					...change,
					from: fromEntry,
					to: toEntry,
					token: tokenEntry
				}
			}
			if (tokenEntry.address === 0n && change.type === 'ERC20') {
				simState.rpcNetwork.chainId
				return {
					...change,
					from: fromEntry,
					to: toEntry,
					token: getArtificialERC20ForEth(simState.rpcNetwork),
				}	
			}
			if ((change.type === 'ERC20' && tokenEntry.type === 'ERC20')) {
				return {
					...change,
					from: fromEntry,
					to: toEntry,
					token: tokenEntry
				}
			}
			if (change.type === 'ERC1155' && tokenEntry.type === 'ERC1155') {
				return {
					...change,
					from: fromEntry,
					to: toEntry,
					token: tokenEntry,
					tokenIdName: namedTokenIds.find((namedTokenId) => namedTokenId.tokenAddress === change.tokenAddress && namedTokenId.tokenId === change.tokenId)?.tokenIdName
				}
			}
			if (change.type === 'NFT All approval' && (tokenEntry.type === 'ERC1155' || tokenEntry.type === 'ERC721')) {
				return {
					...change,
					from: fromEntry,
					to: toEntry,
					token: tokenEntry,
				}
			}
			console.warn('unknown token in token results:')
			console.log(change)
			console.log(tokenEntry)
			return undefined
		}).filter(<T>(x: T | undefined): x is T => x !== undefined)
		return {
			transaction: {
				from: from,
				to: to,
				value: simulatedTx.signedTransaction.value,
				rpcNetwork: simState.rpcNetwork,
				gas: simulatedTx.signedTransaction.gas,
				input: simulatedTx.signedTransaction.input,
				...(simulatedTx.signedTransaction.type === '1559'
					? {
						type: simulatedTx.signedTransaction.type,
						maxFeePerGas: simulatedTx.signedTransaction.maxFeePerGas,
						maxPriorityFeePerGas: simulatedTx.signedTransaction.maxPriorityFeePerGas,
					}
					: { type: simulatedTx.signedTransaction.type }
				),
				hash: simulatedTx.signedTransaction.hash,
				nonce: simulatedTx.signedTransaction.nonce,
			},
			...(to !== undefined ? { to } : {}),
			realizedGasPrice: simulatedTx.realizedGasPrice,
			ethBalanceChanges: ethBalanceChanges,
			tokenResults: tokenResults,
			events: simulatedTx.multicallResponse.statusCode === 'success' ? simulatedTx.multicallResponse.events : [],
			tokenBalancesAfter: simulatedTx.tokenBalancesAfter,
			gasSpent: simulatedTx.multicallResponse.gasSpent,
			quarantine: protectorResult.quarantine,
			quarantineCodes: protectorResult.quarantineCodes,
			...(simulatedTx.multicallResponse.statusCode === 'failure'
				? {
					error: simulatedTx.multicallResponse.error,
					statusCode: simulatedTx.multicallResponse.statusCode,
				}
				: {
					statusCode: simulatedTx.multicallResponse.statusCode,
				}
			),
			website: simulatedTx.website,
			created: simulatedTx.created,
		}
	})
}
