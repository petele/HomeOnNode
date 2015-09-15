/* globals log, home */

'use strict';

var cronJob = function() {
  log.debug('[Cron15]');

  if (home.state.systemState === 'AWAY') {
    home.executeCommand('ALL_LIGHTS', 'OFF', 'AWAY_TIMER');
  }
};

cronJob();
