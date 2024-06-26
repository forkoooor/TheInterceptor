import { Interface } from 'ethers'
import { Erc20ABI, Erc721ABI, MulticallABI } from './abi.js'
import { EthereumAddress } from '../types/wire-types.js'
import { IEthereumClientService } from '../simulation/services/EthereumClientService.js'
import { UniswapV3Multicall2 } from './constants.js'
import { addressString, checksummedAddress, stringToUint8Array } from './bigint.js'
import { Erc1155Entry, Erc20TokenEntry, Erc721Entry } from '../types/addressBookTypes.js'

type EOA = {
	type: 'EOA'
	address: EthereumAddress
}

type UnknownContract = {
	type: 'contract'
	address: EthereumAddress
}

export type IdentifiedAddress = (EOA | Erc20TokenEntry | Erc721Entry | Erc1155Entry | UnknownContract)

async function tryAggregateMulticall(ethereumClientService: IEthereumClientService, requestAbortController: AbortController | undefined, calls: { target: string, callData: string }[]): Promise<{ success: boolean, returnData: string }[]> {
	const multicallInterface = new Interface(MulticallABI)
	const tryAggregate = multicallInterface.getFunction('tryAggregate')
	if (tryAggregate === null) throw new Error('tryAggregate misssing from ABI')
	const returnData = await ethereumClientService.call({ to: UniswapV3Multicall2, input: stringToUint8Array(multicallInterface.encodeFunctionData(tryAggregate, [false, calls])) }, 'latest', requestAbortController)
	return multicallInterface.decodeFunctionResult(tryAggregate, returnData)[0]
}

export async function itentifyAddressViaOnChainInformation(ethereumClientService: IEthereumClientService, requestAbortController: AbortController | undefined, address: EthereumAddress): Promise<IdentifiedAddress> {
	const contractCode = await ethereumClientService.getCode(address, 'latest', requestAbortController)
	if (contractCode.length === 0) return { type: 'EOA', address }

	const nftInterface = new Interface(Erc721ABI)
	const erc20Interface = new Interface(Erc20ABI)
	const target = addressString(address)

	const calls = [
		{ target, callData: nftInterface.encodeFunctionData('supportsInterface', ['0x80ac58cd']) }, // Is Erc721Definition
		{ target, callData: nftInterface.encodeFunctionData('supportsInterface', ['0x5b5e139f']) }, // Is Erc721Metadata
		{ target, callData: nftInterface.encodeFunctionData('supportsInterface', ['0xd9b67a26']) }, // Is Erc1155Definition
		{ target, callData: erc20Interface.encodeFunctionData('name', []) },
		{ target, callData: erc20Interface.encodeFunctionData('symbol', []) },
		{ target, callData: erc20Interface.encodeFunctionData('decimals', []) },
		{ target, callData: erc20Interface.encodeFunctionData('totalSupply', []) }
	]

	try {
		const [isErc721, hasMetadata, isErc1155, name, symbol, decimals, totalSupply] = await tryAggregateMulticall(ethereumClientService, requestAbortController, calls)
		if (isErc721 === undefined || hasMetadata === undefined || isErc1155 === undefined || name === undefined || symbol === undefined || decimals === undefined || totalSupply === undefined) throw new Error('Multicall result is too short')
		if (isErc721.success && nftInterface.decodeFunctionResult('supportsInterface', isErc721.returnData)[0] === true) {
			return {
				type: 'ERC721',
				address,
				name: hasMetadata.success && nftInterface.decodeFunctionResult('supportsInterface', hasMetadata.returnData)[0] ? nftInterface.decodeFunctionResult('name', name.returnData)[0] : checksummedAddress(address),
				symbol: hasMetadata.success && nftInterface.decodeFunctionResult('supportsInterface', hasMetadata.returnData)[0] ? nftInterface.decodeFunctionResult('symbol', symbol.returnData)[0] : '???',
				entrySource: 'OnChain'
			}
		}
		if (isErc1155.success && nftInterface.decodeFunctionResult('supportsInterface', isErc1155.returnData)[0] === true) {
			return {
				type: 'ERC1155',
				address,
				entrySource: 'OnChain',
				name: checksummedAddress(address),
				symbol: '???',
				decimals: undefined
			}
		}
		if (name.success && decimals.success && symbol.success && totalSupply.success) {
			return {
				type: 'ERC20',
				address,
				name: erc20Interface.decodeFunctionResult('name', name.returnData)[0],
				symbol: erc20Interface.decodeFunctionResult('symbol', symbol.returnData)[0],
				decimals: BigInt(erc20Interface.decodeFunctionResult('decimals', decimals.returnData)[0]),
				entrySource: 'OnChain'
			}
		}
	} catch (error) {
		// For any reason decoding txing fails catch and return as unknown contract
		console.warn(error)
		return { type: 'contract', address }
	}

	// If doesn't pass checks being an ERC20, ERC721 or ERC1155, then we only know its a contract
	return { type: 'contract', address }
}
