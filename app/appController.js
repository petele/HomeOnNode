'use strict';

const Home = require('./Home');
const log = require('./SystemLog2');
const fsProm = require('fs/promises');
const WSServer = require('./WSServer');
const FBHelper = require('./FBHelper');
const HTTPServer = require('./HTTPServer');
const DeviceMonitor = require('./DeviceMonitor');

const APP_NAME = 'HomeOnNode';
const LOG_PATH_FB = 'logs/apps/server';
const LOG_PATH_FILE = './logs/system.log';
const MAX_FB_LOG_AGE = 7;

let _wss;
let _home;
let _httpServer;
let _deviceMonitor;

log.startWSS();
log.setFileLogOpts(50, LOG_PATH_FILE);
log.setFirebaseLogOpts(50, LOG_PATH_FB);


/**
 * Init
*/
async function init() {
  log.appStart(APP_NAME);

  _deviceMonitor = new DeviceMonitor(APP_NAME);
  _deviceMonitor.on('restart_request', () => {
    _close();
    _deviceMonitor.restart('FB', 'restart_request', false);
  });
  _deviceMonitor.on('shutdown_request', () => {
    _close();
    _deviceMonitor.shutdown('FB', 'shutdown_request', false);
  });

  try {
    _home = await new Home();
  } catch (ex) {
    const msg = `Error initializing 'home' module.`;
    log.exception(APP_NAME, msg, ex);
    process.exit(1);
  }

  _home.on('ready', () => {
    log.log(APP_NAME, '_ready_ fired');
  });

  _initHTTPServer();
  _initWSServer();
  _initFBCmdListener();
  _setLogOpts();
  _initCronTimers();
}

/**
 * Start the HTTP Server
 */
function _initHTTPServer() {
  _httpServer = new HTTPServer(3000);
  _httpServer.on('executeCommandByName', (name, sender) => {
    _home.executeCommandByName(name, sender);
  });
  _httpServer.on('executeActions', (actions, sender) => {
    _home.executeActions(actions, sender);
  });
}

/**
 * Start the Web Socket Server
 */
function _initWSServer() {
  _wss = new WSServer('CMD', 3003);
  _wss.on('message', (cmd, sender) => {
    if (cmd.flic && cmd.flic.address) {
      sender = `flic://${cmd.flic.address}`;
    }
    if (cmd.hasOwnProperty('cmdName')) {
      return _home.executeCommandByName(cmd.cmdName, sender);
    } else if (cmd.hasOwnProperty('actions')) {
      log.warn(APP_NAME, `Potential invalid command.`, cmd);
      return _home.executeActions(cmd.actions, sender);
    }
    return _home.executeActions(cmd, sender);
  });
}

/**
 * Setup the Firebase command listener ('commands')
 */
async function _initFBCmdListener() {
  const fbRootRef = await FBHelper.getRootRefUnlimited();
  const fbCmdRef = await fbRootRef.child('commands');
  const oldCmdsSnap = await fbCmdRef.once('value');
  const oldCmds = oldCmdsSnap.val();
  if (oldCmds) {
    log.warn(APP_NAME, 'Removing previously requested commands', oldCmds);
    await oldCmdsSnap.ref.remove();
  }
  log.debug(APP_NAME, 'Listening for FB commands...');
  fbCmdRef.on('child_added', (snapshot) => {
    const cmd = snapshot.val();
    const source = cmd.source || 'FB';
    if (cmd.hasOwnProperty('cmdName')) {
      _home.executeCommandByName(cmd.cmdName, source);
    } else if (cmd.hasOwnProperty('actions')) {
      _home.executeActions(cmd.actions, source);
    } else {
      log.warn(APP_NAME, `Potential invalid command.`, cmd);
      _home.executeActions(cmd, source);
    }
    snapshot.ref.remove();
  });
}

/**
 * Set the logging options.
 */
async function _setLogOpts() {
  const fbRootRef = await FBHelper.getRootRefUnlimited();
  const base = `/config/${APP_NAME}/logs`;

  const fbConsoleLogOptRef = await fbRootRef.child(`${base}/console`);
  fbConsoleLogOptRef.on('value', (snapshot) => {
    const opts = snapshot.val();
    const level = opts?.logLevel || 100;
    log.log(APP_NAME, `Changing 'console' log settings`, {level});
    log.setConsoleLogOpts(level);
  });

  const fbFileLogOptRef = await fbRootRef.child(`${base}/file`);
  fbFileLogOptRef.on('value', (snapshot) => {
    const opts = snapshot.val();
    const level = opts?.logLevel || 50;
    const logPath = opts?.logPath || LOG_PATH_FILE;
    log.log(APP_NAME, `Changing 'file' log settings`, {level, logPath});
    log.setFileLogOpts(level, logPath);
  });

  const fbFirebaseLogOptRef = await fbRootRef.child(`${base}/firebase`);
  fbFirebaseLogOptRef.on('value', (snapshot) => {
    const opts = snapshot.val();
    const level = opts?.logLevel || 50;
    const logPath = opts?.logPath || LOG_PATH_FB;
    log.log(APP_NAME, `Changing 'firebase' log settings`, {level, logPath});
    log.setFirebaseLogOpts(level, logPath);
  });
}

/**
 * Initialize the daily cron timers.
 */
function _initCronTimers() {
  setInterval(() => {
    log.verbose(APP_NAME, 'CRON 15');
    _home.executeCommandByName('CRON_15', 'CRON_15');
  }, 15 * 60 * 1000);
  setInterval(() => {
    log.verbose(APP_NAME, 'CRON Hourly');
    _home.executeCommandByName('CRON_60', 'CRON_60');
  }, 60 * 60 * 1000);
  setInterval(() => {
    log.verbose(APP_NAME, 'CRON Daily');
    _home.executeCommandByName('CRON_DAILY', 'CRON_DAILY');
    log.cleanLogs(LOG_PATH_FB, MAX_FB_LOG_AGE);
    _loadAndRunJS('cronDaily.js');
  }, 24 * 60 * 60 * 1000);

  // Run the daily cron job 20min after startup...
  setTimeout(() => {
    log.cleanLogs(LOG_PATH_FB, MAX_FB_LOG_AGE);
    _loadAndRunJS('cronDaily.js');
  }, 20 * 60 * 1000);
}

/**
 * Load and run a JavaScript file.
 *   Used for the cron job system.
 *
 * @param {String} file The file to load and run.
 * @return {Boolean} whether the action completed successfully.
*/
async function _loadAndRunJS(file) {
  const msg = `loadAndRunJS('${file}')`;
  log.debug(APP_NAME, msg);

  let fileContents;
  try {
    fileContents = await fsProm.readFile(file);
    await eval(fileContents.toString());
    return true;
  } catch (ex) {
    log.exception(APP_NAME, `${msg} - Unable to read/run file.`, ex);
    return false;
  }
}

/**
 * Close any open connections to shutdown the controller.
*/
function _close() {
  log.log(APP_NAME, 'Preparing to exit, closing all connections...');
  if (_home) {
    _home.shutdown();
  }
  if (_httpServer) {
    _httpServer.shutdown();
  }
  if (_wss) {
    _wss.shutdown();
  }
}

process.on('SIGINT', function() {
  _close();
  _deviceMonitor.shutdown('SIGINT', 'shutdown_request', 0);
});

init();
