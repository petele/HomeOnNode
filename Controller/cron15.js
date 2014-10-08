var cronJob = function() {
  log.log("[Cron15]");

  if (home.state.system_state === "AWAY") {
    home.set("ALL_LIGHTS", "Off", "AWAY_TIMER");
  }
};



cronJob();