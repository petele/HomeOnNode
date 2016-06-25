/* globals log, home */

'use strict';

var cronJob = function() {
  // log.debug('CRON', '15');

  if (home.state.systemState === 'AWAY') {
    var allOff = {
      hueCommand: {
        lights: 0,
        lightState: {on: false}
      }
    };
    home.executeCommand(allOff, 'AWAY_TIMER');
  }
};

cronJob();
