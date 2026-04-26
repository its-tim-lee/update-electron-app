import os from 'node:os';

module.exports = {
  app: {
    name: 'TestApp',
    getVersion: () => {
      return '1.2.3';
    },
    isReady: () => true,
    on: jest.fn(),
    getAppPath: () => {
      return os.tmpdir();
    },
    isPackaged: true,
  },
  autoUpdater: {
    checkForUpdates: jest.fn(),
    on: jest.fn(),
    setFeedURL: jest.fn(),
    quitAndInstall: jest.fn(),
  },
  dialog: {
    showMessageBox: jest.fn(),
  },
};
