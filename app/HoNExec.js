'use strict';

const util = require('util');
const log = require('./SystemLog2');
const exec = require('child_process').exec;
const EventEmitter = require('events').EventEmitter;

const LOG_PREFIX = 'HON_EXEC';

/**
 * HoN Exec API.
 * @constructor
 *
*/
function HoNExec() {
  let _cmdCount = 0;

  /**
   * Executes a shell command and returns the result in a promise.
   *
   * @param {string} title Title of the command to run.
   * @param {string} cmd The command to run.
   * @param {string} [cwd='.'] The working directory to run the command in.
   * @param {boolean} [quiet=false] Keep logging to a minimum.
   * @return {Promise} The promise that will be resolved on completion.
   */
  this.run = function(title, cmd, cwd, quiet) {
    return new Promise((resolve, reject) => {
      quiet = !!quiet;
      cwd = cwd || '.';
      const cmdId = _cmdCount++;
      const msg = `'${title}' (${cmdId})`;
      const logOpts = {title, cmdId, cmd, cwd, quiet};
      if (quiet) {
        log.verbose(LOG_PREFIX, `Starting ${msg}`, logOpts);
      } else {
        log.log(LOG_PREFIX, `Starting ${msg}`, logOpts);
      }
      const execOptions = {
        cwd: cwd,
        maxBuffer: 1024 * 1024,
      };
      exec(cmd, execOptions, (err, stdOut, stdErr) => {
        stdOut = stdOut.trim();
        if (stdOut) {
          logOpts.stdOut = stdOut;
        }
        stdErr = stdErr.trim();
        if (stdErr) {
          logOpts.stdErr = stdErr;
        }
        if (err) {
          logOpts.error = err.toString();
          log.error(LOG_PREFIX, `Error ${msg}`, logOpts);
          reject(err);
          return;
        }
        if (quiet) {
          log.verbose(LOG_PREFIX, `Completed ${msg}`, logOpts);
        } else {
          log.log(LOG_PREFIX, `Completed ${msg}`, logOpts);
        }
        resolve(true);
      });
    });
  };
}

util.inherits(HoNExec, EventEmitter);

module.exports = HoNExec;
