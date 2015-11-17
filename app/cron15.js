/* globals log, home */

'use strict';

var cronJob = function() {
  log.debug('[Cron15]');

  if (home.state.systemState === 'AWAY') {
    home.executeCommand('LIGHTS_ALL', 'OFF', 'AWAY_TIMER');
  }
};

cronJob();
