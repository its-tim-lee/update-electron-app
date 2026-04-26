import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { autoUpdater, dialog } from 'electron';

import {
  updateElectronApp,
  makeUserNotifier,
  IUpdateInfo,
  IUpdateDialogStrings,
  UpdateSourceType,
} from '../src';
const repo = 'some-owner/some-repo';

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

describe('updateElectronApp', () => {
  const staticUpdateSource = {
    type: UpdateSourceType.StaticStorage,
    baseUrl: 'http://example.com/updates',
  } as const;

  const makeLogger = () => ({
    log: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  });

  it('is a function', () => {
    expect(typeof updateElectronApp).toBe('function');
  });

  describe('repository', () => {
    const tmpdir = os.tmpdir();
    const packageJson = path.join(tmpdir, 'package.json');
    beforeAll(() => {
      fs.writeFileSync(packageJson, JSON.stringify({}));
    });

    it('is required', () => {
      expect(() => {
        updateElectronApp();
      }).toThrow("repo not found. Add repository string to your app's package.json file");
    });

    it('from opts', () => {
      updateElectronApp({ repo: 'foo/bar' });
    });

    it('from package.json', () => {
      fs.writeFileSync(packageJson, JSON.stringify({ repository: 'foo/bar' }));
      updateElectronApp();
    });

    afterAll(() => {
      fs.rmSync(packageJson);
    });
  });

  describe('host', () => {
    it('must be a valid URL', () => {
      expect(() => {
        updateElectronApp({ repo, host: 'not-a-url' });
      }).toThrow('host must be a valid URL');
    });

    it('from default', () => {
      updateElectronApp({
        updateSource: {
          type: UpdateSourceType.ElectronPublicUpdateService,
          repo,
        },
      });
    });
  });

  describe('updateInterval', () => {
    it('must be 5 minutes or more', () => {
      expect(() => {
        updateElectronApp({ repo, updateInterval: '20 seconds' });
      }).toThrow('updateInterval must be `5 minutes` or more');
    });
  });

  describe('simulateUpdateDownloaded', () => {
    it('opens the default dialog with default update info and skips quitAndInstall', async () => {
      const logger = makeLogger();
      jest
        .mocked(dialog.showMessageBox)
        .mockResolvedValueOnce({ response: 0, checkboxChecked: false });

      updateElectronApp({
        logger,
        updateSource: staticUpdateSource,
        simulateUpdateDownloaded: true,
      });

      expect(dialog.showMessageBox).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1000);

      expect(dialog.showMessageBox).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Application Update',
          message: 'TestApp v1.2.3',
        }),
      );

      await Promise.resolve();

      expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith(
        'simulateUpdateDownloaded: restart requested; skipping autoUpdater.quitAndInstall()',
      );
    });

    it('passes default update info to a custom notifier after the configured delay', () => {
      const logger = makeLogger();
      const onNotifyUser = jest.fn();

      updateElectronApp({
        logger,
        onNotifyUser,
        updateSource: staticUpdateSource,
        simulateUpdateDownloaded: {
          delayMs: 25,
        },
      });

      jest.advanceTimersByTime(24);
      expect(onNotifyUser).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(onNotifyUser).toHaveBeenCalledWith(
        expect.objectContaining({
          releaseNotes: 'A simulated update has been downloaded.',
          releaseName: 'TestApp v1.2.3',
          updateURL: 'http://example.com/updates/RELEASES.json',
        }),
      );
    });

    it('validates delayMs', () => {
      expect(() => {
        updateElectronApp({
          repo,
          simulateUpdateDownloaded: {
            delayMs: -1,
          },
        });
      }).toThrow('simulateUpdateDownloaded.delayMs must be a non-negative number');
    });
  });
});

describe('makeUserNotifier', () => {
  const fakeUpdateInfo: IUpdateInfo = {
    event: {} as Electron.Event,
    releaseNotes: 'new release',
    releaseName: 'v13.3.7',
    releaseDate: new Date(),
    updateURL: 'https://fake-update.url',
  };

  beforeEach(() => {
    jest.mocked(dialog.showMessageBox).mockReset();
    jest.mocked(autoUpdater.quitAndInstall).mockReset();
  });

  it('is a function that returns a callback function', () => {
    expect(typeof makeUserNotifier).toBe('function');
    expect(typeof makeUserNotifier()).toBe('function');
  });

  describe('callback', () => {
    it.each([
      ['does', 0, 1],
      ['does not', 1, 0],
    ])(
      '%s call autoUpdater.quitAndInstall if the user responds with %i',
      async (_, response, called) => {
        jest
          .mocked(dialog.showMessageBox)
          .mockResolvedValueOnce({ response, checkboxChecked: false });
        const notifier = makeUserNotifier();
        notifier(fakeUpdateInfo);

        expect(dialog.showMessageBox).toHaveBeenCalled();

        await Promise.resolve();

        expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(called);
      },
    );
  });

  it('can customize dialog properties', () => {
    const strings: IUpdateDialogStrings = {
      title: 'Custom Update Title',
      detail: 'Custom update details',
      restartButtonText: 'Custom restart string',
      laterButtonText: 'Maybe not',
    };

    jest.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false });
    const notifier = makeUserNotifier(strings);
    notifier(fakeUpdateInfo);
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: [strings.restartButtonText, strings.laterButtonText],
        title: strings.title,
        detail: strings.detail,
      }),
    );
  });
});
