window.app = window.app || {};
app.lastInput = Date.now();
app.sortByName = function(a, b) {
  if (a.name < b.name) {
    return -1;
  } else if (a.name > b.name) {
    return 1;
  }
  return 0;
};
