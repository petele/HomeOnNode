import json
import time
import logging
import datetime
from google.appengine.ext import db


def toInt(val, fallback=0):
  try:
    return int(val)
  except:
    return fallback


def toFloat(val, fallback=0.0):
  try:
    return float(val)
  except:
    return fallback


def pad_string(value, pad, length):
  num_pad = length - len(value)
  if num_pad > 0:
    for i in range(num_pad):
      value = pad + value
  return value


def generateTimeHash(timeToHash):
  r_yr = str(timeToHash.year)[-1:]
  r_day = pad_string(str(timeToHash.timetuple().tm_yday), "0", 3)
  r_time = timeToHash.hour * 60 * 60
  r_time += timeToHash.minute * 60
  r_time += timeToHash.second
  r_time = hex(r_time).upper()[2:]
  timeHash = r_yr + r_day + "-" + pad_string(str(r_time), "0", 5)
  return timeHash


def model_to_dict(model):
  output = {}
  SIMPLE_TYPES = (int, long, float, bool, dict, basestring, list)
  for key, prop in model.properties().iteritems():
    value = getattr(model, key)

    if value is None or isinstance(value, SIMPLE_TYPES):
        output[key] = value
    elif isinstance(value, datetime.date):
        output[key] = 1000 * time.mktime(value.utctimetuple())
    elif isinstance(value, db.GeoPt):
        output[key] = {'lat': value.lat, 'lon': value.lon}
    elif isinstance(value, db.Model):
        output[key] = model_to_dict(value)
    else:
        raise ValueError('cannot encode ' + repr(prop))
  return output


def gqlToJSON(gql, max_results=None, remove_key=None):
  result = []
  for item in gql.run(limit=max_results):
    try:
      d_item = model_to_dict(item)
      if remove_key is not None:
        del d_item[remove_key]
      result.append(d_item)
    except Exception, e:
      logging.error("Error converting item to dict: " + str(e))
      logging.error("Item was: " + str(item))
  return json.dumps(result)
