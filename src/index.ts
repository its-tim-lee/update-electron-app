import ms from 'ms';
import type { StringValue as MsStringValue } from 'ms';
import gh from 'github-url-to-object';

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { format } from 'node:util';

import { app, autoUpdater, dialog } from 'electron';
import type { Event } from 'electron';

export interface ILogger {
  log(message: string): void;
  info(message: string): void;
  error(message: string): void;
  warn(message: string): void;
}

export enum UpdateSourceType {
  ElectronPublicUpdateService,
  StaticStorage,
}

export interface IElectronUpdateServiceSource {
  type: UpdateSourceType.ElectronPublicUpdateService;
  /**
   * @param {String} repo A GitHub repository in the format `owner/repo`.
   *                      Defaults to your `package.json`'s `"repository"` field
   */
  repo?: string;
  /**
   * @param {String} host Base URL of the update server.
   *                      Defaults to `https://update.electronjs.org`
   */
  host?: string;
}

export interface IStaticUpdateSource {
  type: UpdateSourceType.StaticStorage;
  /**
   * @param {String} baseUrl Base URL for your static storage provider where your
   *                         updates are stored
   */
  baseUrl: string;
}

export type IUpdateSource = IElectronUpdateServiceSource | IStaticUpdateSource;

export interface IUpdateInfo {
  event: Event;
  releaseNotes: string;
  releaseName: string;
  releaseDate: Date;
  updateURL: string;
}

export interface IUpdateDownloadedSimulationOptions {
  /**
   * @param {Number} delayMs How long to wait before simulating the downloaded update notification.
   *                         Defaults to `1000`.
   */
  delayMs?: number;
}

export interface IUpdateDialogStrings {
  /**
   * @param {String} title The title of the dialog box.
   *                       Defaults to `Application Update`
   */
  title?: string;
  /**
   * @param {String} detail The text of the dialog box.
   *                        Defaults to `A new version has been downloaded. Restart the application to apply the updates.`
   */
  detail?: string;
  /**
   * @param {String} restartButtonText The text of the restart button.
   *                                   Defaults to `Restart`
   */
  restartButtonText?: string;
  /**
   * @param {String} laterButtonText The text of the later button.
   *                                 Defaults to `Later`
   */
  laterButtonText?: string;
}

export interface IUpdateElectronAppOptions<L = ILogger> {
  /**
   * @param {String} repo A GitHub repository in the format `owner/repo`.
   *                      Defaults to your `package.json`'s `"repository"` field
   * @deprecated Use the new `updateSource` option
   */
  readonly repo?: string;
  /**
   * @param {String} host Defaults to `https://update.electronjs.org`
   * @deprecated Use the new `updateSource` option
   */
  readonly host?: string;
  readonly updateSource?: IUpdateSource;
  /**
   * @param {String} updateInterval How frequently to check for updates. Defaults to `10 minutes`.
   *                                Minimum allowed interval is `5 minutes`.
   */
  readonly updateInterval?: string;
  /**
   * @param {Object} logger A custom logger object that defines a `log` function.
   *                        Defaults to `console`. See electron-log, a module
   *                        that aggregates logs from main and renderer processes into a single file.
   */
  readonly logger?: L;
  /**
   * @param {Boolean} notifyUser Defaults to `true`.  When enabled the user will be
   *                             prompted to apply the update immediately after download.
   */
  readonly notifyUser?: boolean;
  /**
   * Optional callback that replaces the default user prompt dialog whenever the 'update-downloaded' event
   * is fired. Only runs if {@link notifyUser} is `true`.
   *
   * @param info - Information pertaining to the available update.
   */
  readonly onNotifyUser?: (info: IUpdateInfo) => void;
  /**
   * Simulates the user notification normally triggered by Electron's native
   * 'update-downloaded' event. This is useful for exercising update prompt UI
   * in development, where the native event may not fire for unpackaged apps.
   */
  readonly simulateUpdateDownloaded?: boolean | IUpdateDownloadedSimulationOptions;
}

const supportedPlatforms = ['darwin', 'win32'];
const isValidUrl = (maybeURL: string) => {
  try {
    // eslint-disable-next-line no-new
    new URL(maybeURL);
    return true;
  } catch {
    return false;
  }
};

export function updateElectronApp(opts: IUpdateElectronAppOptions = {}) {
  // check for bad input early, so it will be logged during development
  const safeOpts = validateInput(opts);

  if (app.isReady()) {
    initUpdater(safeOpts);
  } else {
    app.on('ready', () => initUpdater(safeOpts));
  }
}

function initUpdater(opts: ReturnType<typeof validateInput>) {
  const { updateSource, updateInterval, logger } = opts;

  // exit early on unsupported platforms, e.g. `linux`
  if (!supportedPlatforms.includes(process?.platform)) {
    log(
      `Electron's autoUpdater does not support the '${process.platform}' platform. Ref: https://www.electronjs.org/docs/latest/api/auto-updater#platform-notices`,
    );
    return;
  }

  let feedURL: string;
  let serverType: 'default' | 'json' = 'default';
  switch (updateSource.type) {
    case UpdateSourceType.ElectronPublicUpdateService: {
      feedURL = `${updateSource.host}/${updateSource.repo}/${process.platform}-${
        process.arch
      }/${app.getVersion()}`;
      break;
    }
    case UpdateSourceType.StaticStorage: {
      // Normalize trailing slashes so appending "/RELEASES.json" never creates "//RELEASES.json".
      feedURL = updateSource.baseUrl.replace(/\/+$/, '');
      if (process.platform === 'darwin') {
        feedURL += '/RELEASES.json';
        serverType = 'json';
      }
      break;
    }
  }

  const userAgent = format('%s/%s (%s: %s)', app.name, app.getVersion(), os.platform(), os.arch());
  const requestHeaders = { 'User-Agent': userAgent };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function log(...args: any[]) {
    logger.log(...args);
  }

  log('feedURL', feedURL);
  log('requestHeaders', requestHeaders);
  autoUpdater.setFeedURL({
    url: feedURL,
    headers: requestHeaders,
    serverType,
  });

  autoUpdater.on('error', (err) => {
    log('updater error');
    log(err);
  });

  autoUpdater.on('checking-for-update', () => {
    log('checking-for-update');
  });

  autoUpdater.on('update-available', () => {
    log('update-available; downloading...');
  });

  autoUpdater.on('update-not-available', () => {
    log('update-not-available');
  });

  if (opts.notifyUser) {
    function notifyDownloadedUpdate(info: IUpdateInfo) {
      const { event, releaseNotes, releaseName, releaseDate, updateURL } = info;

      log('update-downloaded', [event, releaseNotes, releaseName, releaseDate, updateURL]);

      let onNotifyUser = opts.onNotifyUser;
      if (typeof onNotifyUser !== 'function') {
        assert(
          opts.onNotifyUser === undefined,
          'onNotifyUser option must be a callback function or undefined',
        );
        log('update-downloaded: notifyUser is true, opening default dialog');
        onNotifyUser = makeUserNotifier(undefined, {
          log,
          simulateUpdateDownloaded: Boolean(opts.simulateUpdateDownloaded),
        });
      } else {
        log('update-downloaded: notifyUser is true, running custom onNotifyUser callback');
      }

      onNotifyUser(info);
    }

    // NOTE: In unpackaged Electron dev runtime on macOS, ShipIt may download the
    // update ZIP but fail validation before Electron emits this native event.
    // Use `simulateUpdateDownloaded` to exercise notification UI in development.
    autoUpdater.on(
      'update-downloaded',
      (event, releaseNotes, releaseName, releaseDate, updateURL) => {
        notifyDownloadedUpdate({
          event,
          releaseNotes,
          releaseDate,
          releaseName,
          updateURL,
        });
      },
    );

    if (opts.simulateUpdateDownloaded) {
      const { delayMs } = normalizeUpdateDownloadedSimulationOptions(opts.simulateUpdateDownloaded);

      setTimeout(() => {
        log('simulateUpdateDownloaded: triggering update-downloaded notification');
        notifyDownloadedUpdate(makeSimulatedUpdateInfo(feedURL));
      }, delayMs);
    }
  }

  // check for updates right away and keep checking later
  autoUpdater.checkForUpdates();
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, ms(updateInterval));
}

/**
 * Helper function that generates a callback for use with {@link IUpdateElectronAppOptions.onNotifyUser}.
 *
 * @param dialogProps - Text to display in the dialog.
 */
export function makeUserNotifier(
  dialogProps?: IUpdateDialogStrings,
  opts: {
    readonly log?: (...args: unknown[]) => void;
    readonly simulateUpdateDownloaded?: boolean;
  } = {},
): (info: IUpdateInfo) => void {
  const defaultDialogMessages = {
    title: 'Application Update',
    detail: 'A new version has been downloaded. Restart the application to apply the updates.',
    restartButtonText: 'Restart',
    laterButtonText: 'Later',
  };

  const assignedDialog = Object.assign({}, defaultDialogMessages, dialogProps);

  return (info: IUpdateInfo) => {
    const { releaseNotes, releaseName } = info;
    const { title, restartButtonText, laterButtonText, detail } = assignedDialog;

    const dialogOpts: Electron.MessageBoxOptions = {
      type: 'info',
      buttons: [restartButtonText, laterButtonText],
      title,
      message: process.platform === 'win32' ? releaseNotes : releaseName,
      detail,
    };

    dialog.showMessageBox(dialogOpts).then(({ response }) => {
      if (response === 0) {
        if (opts.simulateUpdateDownloaded) {
          opts.log?.(
            'simulateUpdateDownloaded: restart requested; skipping autoUpdater.quitAndInstall()',
          );
        } else {
          autoUpdater.quitAndInstall();
        }
      }
    });
  };
}

function normalizeUpdateDownloadedSimulationOptions(
  simulateUpdateDownloaded: true | IUpdateDownloadedSimulationOptions,
): { delayMs: number } {
  if (simulateUpdateDownloaded === true) {
    return {
      delayMs: 1000,
    };
  }

  const { delayMs = 1000 } = simulateUpdateDownloaded;

  return {
    delayMs,
  };
}

function makeSimulatedUpdateInfo(feedURL: string): IUpdateInfo {
  const appName = app.name || 'Application';

  return {
    event: {} as Event,
    releaseNotes: 'A simulated update has been downloaded.',
    releaseName: `${appName}`,
    releaseDate: new Date(),
    updateURL: feedURL,
  };
}

function guessRepo() {
  const pkgBuf = fs.readFileSync(path.join(app.getAppPath(), 'package.json'));
  const pkg = JSON.parse(pkgBuf.toString());
  const repoString = pkg.repository?.url || pkg.repository;
  const repoObject = gh(repoString);
  assert(repoObject, "repo not found. Add repository string to your app's package.json file");
  return `${repoObject.user}/${repoObject.repo}`;
}

function validateInput(opts: IUpdateElectronAppOptions) {
  const defaults = {
    host: 'https://update.electronjs.org',
    updateInterval: '10 minutes',
    logger: console,
    notifyUser: true,
  };

  const { host, updateInterval, logger, notifyUser, onNotifyUser, simulateUpdateDownloaded } =
    Object.assign({}, defaults, opts);

  let updateSource = opts.updateSource;
  // Handle migration from old properties + default to update service
  if (!updateSource) {
    updateSource = {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: opts.repo || guessRepo(),
      host,
    };
  }

  switch (updateSource.type) {
    case UpdateSourceType.ElectronPublicUpdateService: {
      assert(
        updateSource.repo?.includes('/'),
        'repo is required and should be in the format `owner/repo`',
      );

      if (!updateSource.host) {
        updateSource.host = host;
      }

      assert(updateSource.host && isValidUrl(updateSource.host), 'host must be a valid URL');
      break;
    }
    case UpdateSourceType.StaticStorage: {
      assert(
        updateSource.baseUrl && isValidUrl(updateSource.baseUrl),
        'baseUrl must be a valid URL',
      );
      break;
    }
  }

  assert(
    typeof updateInterval === 'string' && updateInterval.match(/^\d+/),
    'updateInterval must be a human-friendly string interval like `20 minutes`',
  );
  const normalizedUpdateInterval = updateInterval as MsStringValue;

  assert(
    ms(normalizedUpdateInterval) >= 5 * 60 * 1000,
    'updateInterval must be `5 minutes` or more',
  );
  assert(
    ms(normalizedUpdateInterval) < 2 ** 31,
    'updateInterval must fit in a signed 32-bit integer',
  );

  assert(logger && typeof logger.log, 'function');

  if (
    typeof simulateUpdateDownloaded === 'object' &&
    simulateUpdateDownloaded.delayMs !== undefined
  ) {
    assert(
      typeof simulateUpdateDownloaded.delayMs === 'number' && simulateUpdateDownloaded.delayMs >= 0,
      'simulateUpdateDownloaded.delayMs must be a non-negative number',
    );
  }

  return {
    updateSource,
    updateInterval: normalizedUpdateInterval,
    logger,
    notifyUser,
    onNotifyUser,
    simulateUpdateDownloaded,
  };
}
