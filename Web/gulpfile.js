/*
Copyright (c) 2015 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

'use strict';

// Include Gulp & tools we'll use
const fs = require('fs');
const gulp = require('gulp');
const del = require('del');
const packageJson = require('./package.json');
const replace = require('gulp-replace');
const moment = require('moment');
const exec = require('child_process').exec;
const gutil = require('gulp-util');
const chalk = require('chalk');

const VERSION_ID = moment().format('YYYYMMDD');
const BUILD_DATE = moment().format('MMMM Do YYYY, h:mm a');

/**
 * Executes a shell command and returns the result in a promise.
 *
 * @param {string} cmd The command to run.
 * @param {string} cwd The working directory to run the command in.
 * @return {Promise} The promise that will be resolved on completion.
 */
function promisedExec(cmd, cwd) {
  return new Promise(function(resolve, reject) {
    const cmdLog = chalk.cyan(`$ ${cmd}`);
    gutil.log(' ', cmdLog);
    const execOptions = {
      cwd: cwd,
      maxBuffer: 1024 * 1024
    };
    exec(cmd, execOptions, function(err, stdOut, stdErr) {
      stdOut = stdOut.trim();
      stdErr = stdErr.trim();
      if (err) {
        const output = (stdOut + '\n' + stdErr).trim();
        reject(err);
        return;
      }
      resolve(stdOut);
    });
  });
}

function setAppYamlVersion() {
  return new Promise(function(resolve, reject) {
    let file = 'build/bundled/app.yaml';
    var content = fs.readFileSync(file, 'utf8');
    content = content.replace(/@@VERSION@@/g, VERSION_ID);
    fs.writeFileSync(file, content);
    resolve(true);
  });
}

gulp.task('updateVersion', function() {
  return new Promise(function(resolve, reject) {
    let file = 'src/my-version.html';
    var content = fs.readFileSync(file, 'utf8');
    let version = `value: '${VERSION_ID}',`;
    let buildDate = `value: '${BUILD_DATE}',`;
    content = content.replace(/value: '\d{8}',/g, version);
    content = content.replace(/value: '\w+ \d{1,2}\w\w \d{4}, .*?',/g, buildDate);
    fs.writeFileSync(file, content);
    resolve(true);
  });
});

gulp.task('clean', function() {
  return del(['build']);
});

gulp.task('serve', function() {
  return promisedExec('polymer serve', '.');
});

gulp.task('serve-sw', ['build'], function() {
  return promisedExec('python -m SimpleHTTPServer', 'build/bundled/');
});

gulp.task('lint', function() {
  return promisedExec('eslint . --ext html --ignore-path .gitignore', '.')
    .then((output) => {
      console.log(output);
    });
});

gulp.task('build', ['clean', 'updateVersion'], function() {
  return promisedExec('polymer build', '.')
    .then((output) => {
      console.log(output);
    })
    .then(setAppYamlVersion);
});

gulp.task('deploy', ['build'], function() {
  return promisedExec('appcfg.py update .', './build/bundled')
    .then((r) => {
      console.log(r);
    })
    .then(() => {
      return promisedExec('appcfg.py migrate_traffic .', './build/bundled');
    })
    .then((r) => {
      console.log(r);
    });
});


