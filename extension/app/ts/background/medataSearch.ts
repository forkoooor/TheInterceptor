import { addressString } from '../utils/bigint.js'
import { AddressInfo } from '../utils/user-interface-types.js'
import { nftMetadata, tokenMetadata, contractMetadata } from '@darkflorist/address-metadata'
import { AddressBookCategory, GetAddressBookDataFilter } from '../utils/interceptor-messages.js'
import { NftDefinition } from '@darkflorist/address-metadata/lib/nftMetadata.js'
import { ContractDefinition } from '@darkflorist/address-metadata/lib/contractMetadata.js'
import { TokenDefinition } from '@darkflorist/address-metadata/lib/tokenMetadata.js'
import { getFullLogoUri } from './metadataUtils.js'
import { UserAddressBook } from './settings.js'

type PartialResult = {
	bestMatchLength: number,
	locationOfBestMatch: number,
}

function fuzzyCompare(pattern: RegExp, searchQuery: string, lowerCasedName: string, address: string) {
	const regexpMatch = bestMatch(lowerCasedName.match(pattern))
	const addressMatch = address.includes(searchQuery) ? searchQuery : ''
	const bestMatchString = regexpMatch === undefined || addressMatch.length > regexpMatch.length ? addressMatch : regexpMatch
	if (bestMatchString.length === 0) return undefined
	return {
		bestMatchLength: bestMatchString.length,
		locationOfBestMatch: lowerCasedName.indexOf(bestMatchString)
	}
}

function bestMatch(matches: RegExpMatchArray | null) {
	if (matches) return [...matches].sort((a, b) => b.length - a.length )[0]
	return undefined
}

function search<ElementType>(searchArray: readonly ElementType[], searchFunction: (elementType: ElementType) => { comparison: PartialResult | undefined, element: ElementType }) {
	const results = searchArray.map((x) => searchFunction(x))
	const undefinedRemoved = results.filter((searchResult): searchResult is { comparison: PartialResult, element: ElementType } => searchResult.comparison !== undefined)
	return undefinedRemoved.sort((a, b) => (a.comparison.bestMatchLength - b.comparison.bestMatchLength) || (a.comparison.locationOfBestMatch - b.comparison.locationOfBestMatch)).map((x) => x.element)
}

function filterAddressBookDataByCategoryAndSearchString(addressBookCategory: AddressBookCategory, searchString: string | undefined, userAddressBook: UserAddressBook) {
	const trimmedSearch = searchString !== undefined && searchString.trim().length > 0 ? searchString.trim().toLowerCase() : undefined
	const searchPattern = trimmedSearch ? new RegExp(`(?=(${ trimmedSearch.split('').join('.*?') }))`) : undefined
	switch(addressBookCategory) {
		case 'My Contacts': return (
			(trimmedSearch === undefined || searchPattern === undefined ? userAddressBook.contacts : search(userAddressBook.addressInfos, (element: AddressInfo) => ({
				comparison: fuzzyCompare(searchPattern, trimmedSearch, element.name.toLowerCase(), addressString(element.address)),
				element: element,
			}))).map((info) => ({
				...info,
				type: 'contact' as const,
			}))
		)
		case 'My Active Addresses': return (
			(trimmedSearch === undefined || searchPattern === undefined ? userAddressBook.addressInfos : search(userAddressBook.addressInfos, (element: AddressInfo) => ({
				comparison: fuzzyCompare(searchPattern, trimmedSearch, element.name.toLowerCase(), addressString(element.address)),
				element: element,
			}))).map((info) => ({
				...info,
				type: 'addressInfo' as const,
			}))
		)
		case 'Tokens': return (
			(trimmedSearch === undefined || searchPattern === undefined ? Array.from(tokenMetadata) : search(Array.from(tokenMetadata), (element: [string, TokenDefinition]) => ({
				comparison: fuzzyCompare(searchPattern, trimmedSearch, `${ element[1].symbol.toLowerCase()} ${ element[1].name.toLowerCase()}`, element[0]),
				element: element,
			}))).map(([address, def]) => ({
				address: BigInt(address),
				...def,
				logoUri: def.logoUri ? `${ getFullLogoUri(def.logoUri) }` : undefined,
				type: 'token' as const,
			}))
		)
		case 'Non Fungible Tokens': return (
			(trimmedSearch === undefined || searchPattern === undefined ? Array.from(nftMetadata) : search(Array.from(nftMetadata), (element: [string, NftDefinition]) => ({
				comparison: fuzzyCompare(searchPattern, trimmedSearch, `${ element[1].symbol.toLowerCase()} ${ element[1].name.toLowerCase()}`, element[0]),
				element: element,
			}))).map(([address, def]) => ({
				address: BigInt(address),
				...def,
				logoUri: def.logoUri ? `${ getFullLogoUri(def.logoUri) }` : undefined,
				type: 'NFT' as const,
			}))
		)
		case 'Other Contracts': return (
			(trimmedSearch === undefined || searchPattern === undefined ? Array.from(contractMetadata) : search(Array.from(contractMetadata), (element: [string, ContractDefinition]) => ({
				comparison: fuzzyCompare(searchPattern, trimmedSearch, `${ 'protocol' in element[1] && element[1].protocol !== undefined ? element[1].protocol.toLowerCase() : ''} ${ element[1].name.toLowerCase() }`, element[0]),
				element: element,
			}))).map(([address, def]) => ({
				address: BigInt(address),
				...def,
				logoUri: def.logoUri ? `${ getFullLogoUri(def.logoUri) }` : undefined,
				type: 'other contract' as const,
			}))
		)
	}
}

export function getMetadataForAddressBookData(filter: GetAddressBookDataFilter, userAddressBook: UserAddressBook) {
	const filtered = filterAddressBookDataByCategoryAndSearchString(filter.filter, filter.searchString, userAddressBook)
	return {
		entries: filtered.slice(filter.startIndex, filter.maxIndex),
		maxDataLength: filtered.length,
	}
}
