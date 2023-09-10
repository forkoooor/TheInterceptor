import { EthereumAddress, EthereumBlockTag, EthereumBytes32, EthereumData, EthereumQuantity, EthereumQuantitySmall, EthereumTimestamp, EthereumUnsignedTransaction, LiteralConverterParserFactory, RevertErrorParser } from './wire-types.js'
import * as funtypes from 'funtypes'

export type AccountOverrideState = funtypes.Static<typeof AccountOverrideState>
export const AccountOverrideState = funtypes.Union(
	funtypes.ReadonlyObject({
		state: EthereumBytes32
	}),
	funtypes.ReadonlyPartial({
		nonce: EthereumQuantitySmall,
		balance: EthereumQuantity,
		code: EthereumData,
		moveToAddress: EthereumAddress,
	})
)

export type AccountOverrideStateDiff = funtypes.Static<typeof AccountOverrideStateDiff>
export const AccountOverrideStateDiff = funtypes.Union(
	funtypes.ReadonlyObject({
		stateDiff: EthereumBytes32
	}),
	funtypes.ReadonlyPartial({
		nonce: EthereumQuantitySmall,
		balance: EthereumQuantity,
		code: EthereumData,
		moveToAddress: EthereumAddress,
	})
)

export type AccountOverride = funtypes.Static<typeof AccountOverride>
export const AccountOverride = funtypes.Union(AccountOverrideState, AccountOverrideStateDiff)

export type BlockOverride = funtypes.Static<typeof BlockOverride>
export const BlockOverride = funtypes.ReadonlyObject({
    number: EthereumQuantity,
    prevRandao: EthereumQuantity,
    time: EthereumTimestamp,
    gasLimit: EthereumQuantitySmall,
    feeRecipient: EthereumAddress,
    baseFee: EthereumQuantity,
})

export type BlockCalls = funtypes.Static<typeof BlockCalls>
export const BlockCalls = funtypes.Union(
	funtypes.ReadonlyObject({
		calls: funtypes.ReadonlyArray(EthereumUnsignedTransaction),
	}),
	funtypes.ReadonlyPartial({
		stateOverrides: funtypes.ReadonlyRecord(funtypes.String, AccountOverride),
		blockOverride: BlockOverride,
	})
)

export type  ExecutionSpec383MultiCallParamObject = funtypes.Static<typeof ExecutionSpec383MultiCallParamObject>
export const  ExecutionSpec383MultiCallParamObject = funtypes.ReadonlyObject({
	blockStateCalls: funtypes.ReadonlyArray(BlockCalls),
	traceTransfers: funtypes.Boolean,
	validation: funtypes.Boolean,
})

export type ExecutionSpec383MultiCallParams = funtypes.Static<typeof ExecutionSpec383MultiCallParams>
export const ExecutionSpec383MultiCallParams = funtypes.ReadonlyObject({
	method: funtypes.Literal('eth_multicallV1'),
	params: funtypes.ReadonlyTuple(ExecutionSpec383MultiCallParamObject, EthereumBlockTag),
})

export type CallResultLog = funtypes.Static<typeof CallResultLog>
export const CallResultLog = funtypes.Intersect(
	funtypes.ReadonlyObject({
		logIndex: EthereumQuantity,
		address: EthereumAddress,
		blockHash: EthereumQuantity,
		blockNumber: EthereumQuantity,
		data: EthereumData,
		topics: funtypes.ReadonlyArray(EthereumBytes32),
		transactionHash: EthereumQuantity,
		transactionIndex: EthereumQuantity,
	})
)

export type ExecutionSpec383CallResultFailure = funtypes.Static<typeof ExecutionSpec383CallResultFailure>
export const ExecutionSpec383CallResultFailure = funtypes.ReadonlyObject({
	  status: funtypes.Literal('0x2').withParser(LiteralConverterParserFactory('0x2', 'failure' as const)),
	  return: EthereumData,
	  gasUsed: EthereumQuantitySmall,
	  error: funtypes.ReadonlyObject({
		  code: funtypes.Number,
		  message: funtypes.String,
		  data: funtypes.String.withParser(RevertErrorParser)
	  })
})

export type ExecutionSpec383CallResultSuccess = funtypes.Static<typeof ExecutionSpec383CallResultSuccess>
export const ExecutionSpec383CallResultSuccess = funtypes.Intersect(
	funtypes.ReadonlyObject({
	  	return: EthereumData,
	  	gasUsed: EthereumQuantitySmall,
		status: funtypes.Literal('0x1').withParser(LiteralConverterParserFactory('0x1', 'success' as const)),
	}),
	funtypes.ReadonlyPartial({
		logs: funtypes.ReadonlyArray(CallResultLog)
	})
)

export type ExecutionSpec383CallResultInvalid = funtypes.Static<typeof ExecutionSpec383CallResultInvalid>
export const ExecutionSpec383CallResultInvalid = funtypes.ReadonlyObject({
	status: funtypes.Literal('0x0').withParser(LiteralConverterParserFactory('0x0', 'invalid' as const)),
	error: funtypes.ReadonlyObject({
		message: funtypes.String,
		code: funtypes.Number
	})
})

export type ExecutionSpec383MultiCallCallResults = funtypes.Static<typeof ExecutionSpec383MultiCallCallResults>
export const ExecutionSpec383MultiCallCallResults = funtypes.ReadonlyArray(funtypes.Union(ExecutionSpec383CallResultFailure, ExecutionSpec383CallResultSuccess, ExecutionSpec383CallResultInvalid))

export type ExecutionSpec383MultiCallBlockResult = funtypes.Static<typeof ExecutionSpec383MultiCallBlockResult>
export const ExecutionSpec383MultiCallBlockResult = funtypes.ReadonlyObject({
    number: EthereumQuantity,
    hash: EthereumQuantity,
    timestamp: EthereumQuantity,
    prevRandao: EthereumQuantity,
    gasLimit: EthereumQuantitySmall,
    gasUsed: EthereumQuantitySmall,
    feeRecipient: EthereumAddress,
    baseFeePerGas: EthereumQuantity,
    calls: ExecutionSpec383MultiCallCallResults,
})

export type ExecutionSpec383MultiCallResult = funtypes.Static<typeof ExecutionSpec383MultiCallResult>
export const ExecutionSpec383MultiCallResult = funtypes.ReadonlyArray(ExecutionSpec383MultiCallBlockResult)