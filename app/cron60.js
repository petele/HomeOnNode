'use strict';

const cronJob = function() {
  // const isAway = _home?.state?.systemState === 'AWAY';
  const isHome = _home?.state?.systemState === 'HOME';
  if (isHome) {
    const runHVACHourlyTimer = _home?.config?.hvac?.hourlyTimer === true;
    if (runHVACHourlyTimer) {
      _home.executeCommandByName('HVAC_HOURLY_TIMER', 'CRON_60');
    }
  }
};

cronJob();
