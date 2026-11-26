/** Script names differ by OS, and hints are needed exactly when the service is not running to ask. */
type NavigatorWithData = Navigator & { userAgentData?: { platform?: string } };
const navigatorInfo = globalThis.navigator as NavigatorWithData | undefined;
export const IS_MAC = /mac/i.test(navigatorInfo?.userAgentData?.platform || navigatorInfo?.platform || '');
const unix = IS_MAC || /linux/i.test(navigatorInfo?.userAgentData?.platform || navigatorInfo?.platform || '');
export const SETUP_SCRIPT = unix ? 'setup.sh' : 'setup.ps1';
export const START_SCRIPT = IS_MAC ? 'Start-NimDaydu.command' : unix ? 'start.sh' : 'Start-NimDaydu.cmd';
