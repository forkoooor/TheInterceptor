import { getInterceptorDisabledSites, getSettings } from "../background/settings.js"
import { checkAndThrowRuntimeLastError } from "./requests.js"

const injectableSitesWildcard = ['file://*/*', 'http://*/*', 'https://*/*']
const injectableSitesRegexp = [/^file:\/\/.*/, /^http:\/\/.*/, /^https:\/\/.*/]

export const updateContentScriptInjectionStrategyManifestV3 = async () => {
	const excludeMatches = getInterceptorDisabledSites(await getSettings()).map((origin) => `*://*.${ origin }/*`)
	try {
		type RegisteredContentScript = Parameters<typeof browser.scripting.registerContentScripts>[0][0]
		// 'MAIN'` is not supported in `browser.` but its in `chrome.`. This code is only going to be run in manifest v3 environment (chrome) so this should be fine, just ugly
		type FixedRegisterContentScripts = (scripts: (RegisteredContentScript & { world?: 'MAIN' | 'ISOLATED' })[]) => Promise<void>
		const fixedRegisterContentScripts = ((browser.scripting.registerContentScripts as unknown) as FixedRegisterContentScripts)
		await browser.scripting.unregisterContentScripts()
		await fixedRegisterContentScripts([{
			id: 'inpage2',
			matches: injectableSitesWildcard,
			excludeMatches,
			js: ['/vendor/webextension-polyfill/browser-polyfill.js', '/inpage/js/listenContentScript.js'],
			runAt: 'document_start',
		}, {
			id: 'inpage',
			matches: injectableSitesWildcard,
			excludeMatches,
			js: ['/inpage/js/inpage.js'],
			runAt: 'document_start',
			world: 'MAIN',
		}])
	} catch (err) {
		console.warn(err)
	}
}

const injectLogic = async (content: browser.webNavigation._OnCommittedDetails) => {
	if (!injectableSitesRegexp.some(regexpPattern => regexpPattern.test(content.url))) return
	const disabledSites = getInterceptorDisabledSites(await getSettings())
	const hostName = new URL(content.url).hostname
	const noMatches = disabledSites.every(excludeMatch => hostName !== excludeMatch)
	if (!noMatches) return
	try {
		await browser.tabs.executeScript(content.tabId, { file: '/vendor/webextension-polyfill/browser-polyfill.js', allFrames: false, runAt: 'document_start' })
		await browser.tabs.executeScript(content.tabId, { file: '/inpage/js/document_start.js', allFrames: false, runAt: 'document_start' })
		checkAndThrowRuntimeLastError()
	} catch(error) {
		if (error instanceof Error && error.message.startsWith('No tab with id')) return
		throw error
	}
}

export const updateContentScriptInjectionStrategyManifestV2 = async () => {
	browser.webNavigation.onCommitted.removeListener(injectLogic)
	browser.webNavigation.onCommitted.addListener(injectLogic, { url: injectableSitesWildcard.map((urlMatches) => ({ urlMatches })) })
}
