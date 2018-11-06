/* eslint-disable */
'use strict';

const moment = require('moment');
const chalk = require('chalk');

const r = `-X-XXX-T17:15D90`;

/**
 * Checks if the current time is between the specified range
 *
 * @param {string} range - Format smtwtfsThh:hhDmm.
 *                         - 0-6: days of the week to run, use '-' to skip day.
 *                         - 7: Must be 'T'.
 *                         - 8-12: Time to start 24 hr format, eg 23:30.
 *                         - 13: Must be 'D'.
 *                         - 14+: Number of minutes the duration lasts.
 */
function inRange(range, n) {
  const RE_RANGE = /^(.{7})T(\d\d):(\d\d)D(\d+)$/;
  const matched = range.match(RE_RANGE);
  if (!matched || matched.length !== 5) {
    return false;
  }
  const maDay = matched[1];
  const maHour = matched[2];
  const maMinute = matched[3];
  const maDuration = parseInt(matched[4]);
  const now = moment(n).second(0).millisecond(0);
  const tomorrow = now.clone().hour(0).minute(0).add(1, 'day');

  const mStart = now.clone().hour(maHour).minute(maMinute);
  const mStop = mStart.clone().add(maDuration, 'minutes');

  if (mStop.isAfter(tomorrow)) {
    const numMinIntoDay = moment.duration(tomorrow.diff(now)).asMinutes();
    if (numMinIntoDay > maDuration) {
      mStart.subtract(1, 'day');
      mStop.subtract(1, 'day');
    }
  }
  if (maDay[mStart.isoWeekday() % 7] === '-') {
    return false;
  }
  if (now.isBetween(mStart, mStop)) {
    return true;
  }
  return false;
}


const tests = [
  {r: 'XXXXXXXT00:00D1440', d: '2018-11-06T14:25:00.000', e: true},
  {r: '-------T00:00D1440', d: '2018-11-06T14:25:00.000', e: false},
  {r: 'XXXXXXXT12:00D60', d: '2018-11-04T12:15:00.000', e: true},
  {r: 'XXXXXXXT12:00D60', d: '2018-11-04T13:15:00.000', e: false},


  {r: '---X---T23:30D60', d: '2018-11-07T23:15:00.000', e: false},
  {r: '---X---T23:30D60', d: '2018-11-07T23:35:00.000', e: true},
  {r: '---X---T23:30D60', d: '2018-11-08T00:15:00.000', e: true},
  {r: '---X---T23:30D60', d: '2018-11-08T00:35:00.000', e: false},

  {r: '------XT23:30D60', d: '2018-11-10T23:15:00.000', e: false},
  {r: '------XT23:30D60', d: '2018-11-10T23:35:00.000', e: true},
  {r: '------XT23:30D60', d: '2018-11-11T00:15:00.000', e: true},
  {r: '------XT23:30D60', d: '2018-11-11T00:35:00.000', e: false},

  {r: 'X------T23:30D60', d: '2018-11-04T23:15:00.000', e: false},
  {r: 'X------T23:30D60', d: '2018-11-04T23:35:00.000', e: true},
  {r: 'X------T23:30D60', d: '2018-11-05T00:15:00.000', e: true},
  {r: 'X------T23:30D60', d: '2018-11-05T00:35:00.000', e: false},
]


tests.forEach((test) => {
  const e = test.e;
  const v = inRange(test.r, test.d);

  const p = e === v ? chalk.green('true') : chalk.red('false');
  console.log(`Result: ${p} - ${chalk.magenta(test.r)} - ${chalk.cyan(e)} / ${chalk.cyan(v)}`);
});

