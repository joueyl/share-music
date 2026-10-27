import { version } from '../../../package.json';
import changelog from '../../../CHANGELOG.md?raw';
import { parseChangelog } from './release-history';
export const APP_VERSION=version;
export const RELEASE_HISTORY=parseChangelog(changelog);
