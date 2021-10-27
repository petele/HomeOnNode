/* globals _home */

'use strict';

const cronJob = function() {
  const isAway = _home?.state?.systemState === 'AWAY';
  // const isHome = _home?.state?.systemState === 'HOME';
  if (isAway) {
    _home.executeCommandByName('RUN_ON_AWAY', 'CRON_15');
  }
};

cronJob();
