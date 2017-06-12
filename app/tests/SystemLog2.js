'use strict';

const fs = require('fs');
const log = require('../SystemLog2');
const helpers = require('./helpers');
const assert = require('../node_modules/chai').assert;

helpers.setBasicLogging();

const NOW = 1497297200123;

log.setAppName('-TEST-TEST-TEST-');

function generateSimpleLogObj(kind) {
  let result = {
    appName: '_appname_',
    hostname: '_hostname_',
    date: NOW,
    dateFormatted: log.formatTime(NOW),
    level: 'INFO',
    levelValue: 50,
    prefix: '_PREFIX_',
    message: '_this is the message_',
  };
  if (kind === 'extra') {
    result.extra = {
      more: {
        bool: true,
        num: 123,
        obj: {
          drink: 'coke',
          blah: 'blah',
        },
      },
    };
  } else if (kind === 'exception') {
    result.exception = new Error('sample_error');
  }
  return result;
}

function logItems() {
  log.appStart('-app-start-');
  log.init('TEST', 'init-message');
  log.log('TEST', 'log-message');
  log.log('TEST', 'log-message-extra', {foo: 'bar'});
  log.info('TEST', 'info-message');
  log.error('TEST', 'error-message');
  log.exception('TEST', 'exception-message', new Error('sample_error'));
  log.warn('TEST', 'warn-message');
  log.debug('TEST', 'debug-message');
  log.verbose('TEST', 'verbose-message');
  log.http('TEST', 'HTTP', 'http-message');
  log.todo('TEST', 'todo-message');
  log.custom('CUSTM', 'TEST', 'custom-message');
  log.appStop('TEST', '-app-stop-');
}

function readLogsFromFirebase(fb, path) {
  return fb.child(path).once('value')
    .then(function(snapshot) {
      let results = {
        start: 0, info: 0, init: 0, error: 0, excpt: 0, warn: 0, debug: 0,
        extra: 0, http: 0, todo: 0, custom: 0, stop: 0, unknown: 0, count: 0,
      };
      snapshot.forEach(function(child) {
        let logObj = child.val();
        if (logObj.level === 'START') {
          results.start++;
        } else if (logObj.level === 'INFO') {
          results.info++;
        } else if (logObj.level === 'INIT') {
          results.init++;
        } else if (logObj.level === 'ERROR') {
          results.error++;
        } else if (logObj.level === 'EXCPT') {
          results.excpt++;
        } else if (logObj.level === 'WARN') {
          results.warn++;
        } else if (logObj.level === 'DEBUG') {
          results.debug++;
        } else if (logObj.level === 'EXTRA') {
          results.extra++;
        } else if (logObj.level === 'HTTP') {
          results.http++;
        } else if (logObj.level === 'TODO') {
          results.todo++;
        } else if (logObj.level === 'CUSTOM') {
          results.custom++;
        } else if (logObj.level === 'STOP') {
          results.stop++;
        } else {
          results.unknown++;
        }
        results.count++;
      });
      return results;
    });
}

describe('SystemLog2', function() {

  const NOW_SHORT = '2017-06-12T15:53:20';
  const NOW_LONG = '2017-06-12T15:53:20.123';

  const TEST_TIMEOUT = 50000;
  this.timeout(TEST_TIMEOUT);

  describe('#formatTime()', function() {
    describe('short', function() {
      it(NOW_SHORT, function() {
        let result = log.formatTime(NOW, true);
        assert.equal(result, NOW_SHORT);
      });
    });
    describe('long', function() {
      it(NOW_LONG, function() {
        let result = log.formatTime(NOW);
        assert.equal(result, NOW_LONG);
      });
    });
  });

  describe('#stringifyLog()', function() {
    describe('simple log object', function() {
      let logObj = generateSimpleLogObj();
      let result = log.stringifyLog(logObj);
      it('includes correct time', function() {
        assert.include(result, NOW_LONG);
      });
      it('includes correct level', function() {
        assert.include(result, logObj.level);
      });
      it('includes correct message', function() {
        assert.include(result, logObj.message);
      });
    });
    describe('with extra object', function() {
      let logObj = generateSimpleLogObj('extra');
      let result = log.stringifyLog(logObj);
      it('includes correct time', function() {
        assert.include(result, NOW_LONG);
      });
      it('includes correct level', function() {
        assert.include(result, logObj.level);
      });
      it('includes correct message', function() {
        assert.include(result, logObj.message);
      });
      it('includes 2 lines', function() {
        assert.equal(result.split('\n').length, 2);
      });
      it('includes the extra details', function() {
        assert.include(result, '{ more:');
      });
    });
    describe('with exception', function() {
      let logObj = generateSimpleLogObj('exception');
      let result = log.stringifyLog(logObj);
      it('includes correct time', function() {
        assert.include(result, NOW_LONG);
      });
      it('includes correct level', function() {
        assert.include(result, logObj.level);
      });
      it('includes correct message', function() {
        assert.include(result, logObj.message);
      });
      it('includes the right number of lines', function() {
        assert.equal(result.split('\n').length, 34);
      });
      it('includes the exception details', function() {
        assert.include(result, `|  Error: sample_error`);
      });
      it('includes the stack trace', function() {
        assert.include(result, '|      at Suite.<anonymous>');
      });
    });
  });

  describe('Log to file', function() {
    let result;

    let opts = {
      fileLogLevel: 90,
      fileFilename: './tests.log',
      consoleLogLevel: -1,
      firebaseLogLevel: -1,
      firebasePath: 'logs/tests',
    };

    describe('Log Level at 90', function() {
      it('clear log, set options and log items', function() {
        fs.writeFileSync('./tests.log', '');
        log.setOptions(opts);
        logItems();
      });
      it('should not contain ANSI', function() {
        result = fs.readFileSync('./tests.log', 'utf8');
        assert.notInclude(result, '\u001b[32m');
      });
      it('should the right number of lines', function() {
        assert.equal(result.split('\n').length, 32);
      });
      it('should the right number of START items', function() {
        assert.equal(result.match(/\| START \|/g).length, 1);
      });
      it('should the right number of INIT items', function() {
        assert.equal(result.match(/\| {2}INIT \|/g).length, 1);
      });
      it('should the right number of INFO items', function() {
        assert.equal(result.match(/\| {2}INFO \|/g).length, 5);
      });
      it('should the right number of ERROR items', function() {
        assert.equal(result.match(/\| ERROR \|/g).length, 1);
      });
      it('should the right number of EXCPT items', function() {
        assert.equal(result.match(/\| EXCPT \|/g).length, 15);
      });
      it('should the right number of WARN items', function() {
        assert.equal(result.match(/\| {2}WARN \|/g).length, 1);
      });
      it('should the right number of DEBUG items', function() {
        assert.equal(result.match(/\| DEBUG \|/g).length, 1);
      });
      it('should the right number of EXTRA items', function() {
        assert.equal(result.match(/\| EXTRA \|/g).length, 1);
      });
      it('should the right number of TODO items', function() {
        assert.equal(result.match(/\| {2}TODO \|/g).length, 1);
      });
      it('should the right number of CUSTOM items', function() {
        assert.equal(result.match(/\| CUSTM \|/g).length, 1);
      });
      it('should the right number of HTTP items', function() {
        assert.equal(result.match(/\| {2}HTTP \|/g).length, 2);
      });
      it('should the right number of STOP items', function() {
        assert.equal(result.match(/\| {2}STOP \|/g).length, 1);
      });
    });

    describe('Log Level at 50', function() {
      it('clear log, set options and log items', function() {
        fs.writeFileSync('./tests.log', '');
        opts.fileLogLevel = 50;
        log.setOptions(opts);
        logItems();
      });
      it('should not contain ANSI', function() {
        result = fs.readFileSync('./tests.log', 'utf8');
        assert.notInclude(result, '\u001b[32m');
      });
      it('should the right number of lines', function() {
        assert.equal(result.split('\n').length, 29);
      });
      it('should the right number of START items', function() {
        assert.equal(result.match(/\| START \|/g).length, 1);
      });
      it('should the right number of INIT items', function() {
        assert.equal(result.match(/\| {2}INIT \|/g).length, 1);
      });
      it('should the right number of INFO items', function() {
        assert.equal(result.match(/\| {2}INFO \|/g).length, 5);
      });
      it('should the right number of ERROR items', function() {
        assert.equal(result.match(/\| ERROR \|/g).length, 1);
      });
      it('should the right number of EXCPT items', function() {
        assert.equal(result.match(/\| EXCPT \|/g).length, 15);
      });
      it('should the right number of WARN items', function() {
        assert.equal(result.match(/\| {2}WARN \|/g).length, 1);
      });
      it('should the right number of DEBUG items', function() {
        assert.equal(result.match(/\| DEBUG \|/g), null);
      });
      it('should the right number of EXTRA items', function() {
        assert.equal(result.match(/\| EXTRA \|/g), null);
      });
      it('should the right number of TODO items', function() {
        assert.equal(result.match(/\| {2}TODO \|/g), null);
      });
      it('should the right number of CUSTOM items', function() {
        assert.equal(result.match(/\| CUSTM \|/g).length, 1);
      });
      it('should the right number of HTTP items', function() {
        assert.equal(result.match(/\| {2}HTTP \|/g).length, 2);
      });
      it('should the right number of STOP items', function() {
        assert.equal(result.match(/\| {2}STOP \|/g).length, 1);
      });
    });

    describe('Log Level at 20', function() {
      it('clear log, set options and log items', function() {
        fs.writeFileSync('./tests.log', '');
        opts.fileLogLevel = 20;
        log.setOptions(opts);
        logItems();
      });
      it('should not contain ANSI', function() {
        result = fs.readFileSync('./tests.log', 'utf8');
        assert.notInclude(result, '\u001b[32m');
      });
      it('should the right number of lines', function() {
        assert.equal(result.split('\n').length, 20);
      });
      it('should the right number of START items', function() {
        assert.equal(result.match(/\| START \|/g).length, 1);
      });
      it('should the right number of INIT items', function() {
        assert.equal(result.match(/\| {2}INIT \|/g).length, 1);
      });
      it('should the right number of INFO items', function() {
        assert.equal(result.match(/\| {2}INFO \|/g), null);
      });
      it('should the right number of ERROR items', function() {
        assert.equal(result.match(/\| ERROR \|/g).length, 1);
      });
      it('should the right number of EXCPT items', function() {
        assert.equal(result.match(/\| EXCPT \|/g).length, 15);
      });
      it('should the right number of WARN items', function() {
        assert.equal(result.match(/\| {2}WARN \|/g), null);
      });
      it('should the right number of DEBUG items', function() {
        assert.equal(result.match(/\| DEBUG \|/g), null);
      });
      it('should the right number of EXTRA items', function() {
        assert.equal(result.match(/\| EXTRA \|/g), null);
      });
      it('should the right number of TODO items', function() {
        assert.equal(result.match(/\| {2}TODO \|/g), null);
      });
      it('should the right number of CUSTOM items', function() {
        assert.equal(result.match(/\| CUSTM \|/g), null);
      });
      it('should the right number of HTTP items', function() {
        assert.equal(result.match(/\| {2}HTTP \|/g), null);
      });
      it('should the right number of STOP items', function() {
        assert.equal(result.match(/\| {2}STOP \|/g).length, 1);
      });
    });
  });

  describe('Log to Firebase', function() {
    let fb;
    let results;

    let opts = {
      fileLogLevel: -1,
      fileFilename: './tests.log',
      consoleLogLevel: -1,
      firebaseLogLevel: 90,
      firebasePath: 'logs/tests',
    };
    it('set firebase ref', function() {
      return helpers.getFBRef().then(function(_fb) {
        fb = _fb;
        log.setFirebaseRef(fb);
      });
    });

    describe('Log Level at 90', function() {
      it('clear logs', function() {
        return fb.child('logs/tests').ref().remove();
      });
      it('set options and log items', function() {
        results = {};
        log.setOptions(opts);
        logItems();
        return helpers.sleep(5 * 1000);
      });
      it('should contain 17 items', function() {
        return readLogsFromFirebase(fb, opts.firebasePath)
          .then(function(res) {
            results = res;
          })
          .then(function() {
            assert.equal(results.count, 17);
          });
      });
      it('should the right number of START items', function() {
        assert.equal(results.start, 1);
      });
      it('should the right number of INIT items', function() {
        assert.equal(results.init, 1);
      });
      it('should the right number of INFO items', function() {
        assert.equal(results.info, 6);
      });
      it('should the right number of ERROR items', function() {
        assert.equal(results.error, 1);
      });
      it('should the right number of EXCPT items', function() {
        assert.equal(results.excpt, 1);
      });
      it('should the right number of WARN items', function() {
        assert.equal(results.warn, 1);
      });
      it('should the right number of DEBUG items', function() {
        assert.equal(results.debug, 1);
      });
      it('should the right number of EXTRA items', function() {
        assert.equal(results.extra, 1);
      });
      it('should the right number of TODO items', function() {
        assert.equal(results.todo, 1);
      });
      it('should the right number of HTTP items', function() {
        assert.equal(results.http, 1);
      });
      it('should the right number of STOP items', function() {
        assert.equal(results.stop, 1);
      });
      it('should the right number of UNKNOWN items', function() {
        assert.equal(results.unknown, 1);
      });
    });

    describe('Log Level at 50', function() {
      it('clear logs', function() {
        return fb.child('logs/tests').ref().remove();
      });
      it('set options and log items', function() {
        results = {};
        opts.firebaseLogLevel = 50;
        log.setOptions(opts);
        logItems();
        return helpers.sleep(5 * 1000);
      });
      it('should contain 14 items', function() {
        return readLogsFromFirebase(fb, opts.firebasePath)
          .then(function(res) {
            results = res;
          })
          .then(function() {
            assert.equal(results.count, 14);
          });
      });
      it('should the right number of START items', function() {
        assert.equal(results.start, 1);
      });
      it('should the right number of INIT items', function() {
        assert.equal(results.init, 1);
      });
      it('should the right number of INFO items', function() {
        assert.equal(results.info, 6);
      });
      it('should the right number of ERROR items', function() {
        assert.equal(results.error, 1);
      });
      it('should the right number of EXCPT items', function() {
        assert.equal(results.excpt, 1);
      });
      it('should the right number of WARN items', function() {
        assert.equal(results.warn, 1);
      });
      it('should the right number of DEBUG items', function() {
        assert.equal(results.debug, 0);
      });
      it('should the right number of EXTRA items', function() {
        assert.equal(results.extra, 0);
      });
      it('should the right number of TODO items', function() {
        assert.equal(results.todo, 0);
      });
      it('should the right number of HTTP items', function() {
        assert.equal(results.http, 1);
      });
      it('should the right number of STOP items', function() {
        assert.equal(results.stop, 1);
      });
      it('should the right number of UNKNOWN items', function() {
        assert.equal(results.unknown, 1);
      });
    });

    describe('Log Level at 20', function() {
      it('clear logs', function() {
        return fb.child('logs/tests').ref().remove();
      });
      it('set options and log items', function() {
        results = {};
        opts.firebaseLogLevel = 20;
        log.setOptions(opts);
        logItems();
        return helpers.sleep(5 * 1000);
      });
      it('should contain 5 items', function() {
        return readLogsFromFirebase(fb, opts.firebasePath)
          .then(function(res) {
            results = res;
          })
          .then(function() {
            assert.equal(results.count, 5);
          });
      });
      it('should the right number of START items', function() {
        assert.equal(results.start, 1);
      });
      it('should the right number of INIT items', function() {
        assert.equal(results.init, 1);
      });
      it('should the right number of INFO items', function() {
        assert.equal(results.info, 0);
      });
      it('should the right number of ERROR items', function() {
        assert.equal(results.error, 1);
      });
      it('should the right number of EXCPT items', function() {
        assert.equal(results.excpt, 1);
      });
      it('should the right number of WARN items', function() {
        assert.equal(results.warn, 0);
      });
      it('should the right number of DEBUG items', function() {
        assert.equal(results.debug, 0);
      });
      it('should the right number of EXTRA items', function() {
        assert.equal(results.extra, 0);
      });
      it('should the right number of TODO items', function() {
        assert.equal(results.todo, 0);
      });
      it('should the right number of HTTP items', function() {
        assert.equal(results.http, 0);
      });
      it('should the right number of STOP items', function() {
        assert.equal(results.stop, 1);
      });
      it('should the right number of UNKNOWN items', function() {
        assert.equal(results.unknown, 0);
      });
    });
  });

  describe('Clean Logs', function() {
    let fb;
    let results;

    let opts = {
      fileLogLevel: -1,
      fileFilename: './tests.log',
      consoleLogLevel: -1,
      firebaseLogLevel: 90,
      firebasePath: 'logs/tests',
    };
    const DAY = 60 * 60 * 24 * 1000;
    describe('Setup', function() {
      it('set firebase ref', function() {
        return helpers.getFBRef().then(function(_fb) {
          fb = _fb;
          log.setFirebaseRef(fb);
        });
      });
      it('clear logs', function() {
        return fb.child('logs/tests').ref().remove();
      });
      it('add sample log items', function() {
        let now = Date.now();
        for (let i = 0; i < 40; i++) {
          let obj = {
            date: now,
          };
          fb.child('logs/tests').push(obj);
          now = now - DAY;
        }
        now = now - (DAY * 360);
        for (let i = 0; i < 40; i++) {
          let obj = {
            date: now,
          };
          fb.child('logs/tests').push(obj);
          now = now - DAY;
        }
        return helpers.sleep(5000);
      });
    });
    describe('Clean', function() {
      it('Default', function() {
        return log.cleanLogs('logs/tests')
          .then(function(result) {
            assert.equal(result.count, 40);
          });
      });
      it('30 days', function() {
        return log.cleanLogs('logs/tests', 30)
          .then(function(result) {
            assert.equal(result.count, 10);
          });
      });
      it('20 days', function() {
        return log.cleanLogs('logs/tests', 20)
          .then(function(result) {
            assert.equal(result.count, 10);
          });
      });
      it('10 days', function() {
        return log.cleanLogs('logs/tests', 10)
          .then(function(result) {
            assert.equal(result.count, 10);
          });
      });
      it('1 day', function() {
        return log.cleanLogs('logs/tests', 1)
          .then(function(result) {
            assert.equal(result.count, 9);
          });
      });
    });
  });


  after(function() {
  });
});
