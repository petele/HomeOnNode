import os
import json
import jinja2
import webapp2
import logging
import AEHelpers
from uuid import uuid4
from datetime import datetime
from google.appengine.api import memcache
from google.appengine.api import channel
from google.appengine.api import users
from google.appengine.ext import db

JINJA_ENVIRONMENT = jinja2.Environment(
    loader=jinja2.FileSystemLoader(os.path.dirname(__file__)),
    extensions=['jinja2.ext.autoescape'])

def user_requestkey(request_name=None):
  return db.Key.from_path('UserList', request_name or 'default_queue')

class UserList(db.Model):
  account = db.UserProperty()
  uuid = db.StringProperty()

def get_user_uuid(user):
  memcache_key = "user#" + user.user_id()
  user_uuid = memcache.get(memcache_key)
  if user_uuid is None:
    try:
      gquery = 'SELECT * from UserList where account = :1'
      query = db.GqlQuery(gquery, user)
      account = query.get()
      user_uuid = account.uuid
      memcache.set(memcache_key, user_uuid)
    except:
      user_uuid = None
  return user_uuid

def valid_user(user_key):
  memcache_key = "UserList"
  user_list = memcache.get(memcache_key)
  if user_list is None:
    gquery = 'SELECT * from UserList'
    query = db.GqlQuery(gquery)
    user_list = []
    for user in query:
      user_list.append(user.uuid)
    memcache.set(memcache_key, user_list)
  if user_key in user_list:
    return True
  else:
    return False
  

def track_requestkey(request_name=None):
  return db.Key.from_path('Track', request_name or 'default_queue')

class Track(db.Model):
  user_key = db.StringProperty()
  event_time = db.DateTimeProperty()
  component = db.StringProperty()
  value = db.StringProperty()


class SetData(webapp2.RequestHandler):
  def post(self):
    response = ""
    data = self.request.body
    try:
      data_json = json.loads(data)
      user_key = data_json["user_key"]
      if valid_user(user_key):
        item_type = self.request.path.split("/")[-1:]
        memcache_key = user_key + "#" + item_type[0]
        memcache.set(memcache_key, data)
        channel.send_message(user_key, data)
        response = "OK"
      else:
        self.error(401)
        response = "NO"
    except:
      logging.exception("Unable to store data")
      self.error(500)
      response = "ERROR"
    self.response.headers['Content-Type'] = 'text/plain'
    self.response.headers['Access-Control-Allow-Origin'] = '*'
    self.response.out.write(response)


class TrackData(webapp2.RequestHandler):
  def post(self):
    response = ""
    data = self.request.body
    try:
      data_json = json.loads(data)
      user_key = data_json["user_key"]
      if valid_user(user_key):
        item = Track(parent=track_requestkey())
        item.event_time = datetime.now()
        item.user_key = user_key
        item.component = str(data_json["component"])
        item.value = str(data_json["value"])
        item.put()
        response = "OK"
      else:
        self.error(401)
        response = "NO"
    except:
      logging.exception("Unable to store tracked data.")
      self.error(500)
      response = "ERROR"
    self.response.headers['Content-Type'] = 'text/plain'
    self.response.headers['Access-Control-Allow-Origin'] = '*'
    self.response.out.write(response)


class GetData(webapp2.RequestHandler):
  def post(self):
    response = ""
    clear = self.request.get("clear")
    try:
      user_key = self.request.body
      if valid_user(user_key):
        item_type = self.request.path.split("/")[-1:]
        memcache_key = user_key + "#" + item_type[0]
        response = memcache.get(memcache_key)
        if clear == "true":
          memcache.delete(memcache_key)
        if response is None:
          response = ""
          self.error(404)
      else:
        logging.error(user_key)
        self.error(401)
        response = "NO"
    except:
      logging.exception("Unable to retreive data from store")
      self.error(500)
    self.response.headers['Content-Type'] = 'application/json'
    self.response.headers['Access-Control-Allow-Origin'] = '*'
    self.response.out.write(response)


def GetTrackLogs(component, user_key):
  query = "SELECT * from Track where component=:1 and user_key=:2 order by event_time desc"
  gquery = db.GqlQuery(query, component, user_key)
  return AEHelpers.gqlToJSON(gquery, 20)


class GetDoor(webapp2.RequestHandler):
  def post(self):
    response = "[]"
    user_key = self.request.body
    if user_key is not None:
      response = GetTrackLogs("FRONT_DOOR", user_key)
    else:
      self.error(401)
    self.response.headers['Content-Type'] = 'application/json'
    self.response.headers['Access-Control-Allow-Origin'] = '*'
    self.response.out.write(response)

class GetState(webapp2.RequestHandler):
  def post(self):
    response = "[]"
    user_key = self.request.body
    if user_key is not None:
      response = GetTrackLogs("STATE", user_key)
    else:
      self.error(401)
    self.response.headers['Content-Type'] = 'application/json'
    self.response.headers['Access-Control-Allow-Origin'] = '*'
    self.response.out.write(response)


class Commands(webapp2.RequestHandler):
  def post(self):
    response = ""
    try:
      if self.request.get("clear") == "true":
        clear = True
      else:
        clear = False
      item_type = self.request.path.split("/")[-1:]
      if item_type[0] == "get":
        user_key = self.request.body
        if valid_user(user_key):
          memcache_key = user_key + "##Cmds"
          cmds = memcache.get(memcache_key)
          if cmds is not None:
            response = json.dumps(cmds)
            if clear is True:
              memcache.delete(memcache_key)
          else:
            response = "[]"
        else:
          self.error(401)
          response = "NO"
      elif item_type[0] == "add":
        data_json = json.loads(self.request.body)
        user_key = data_json["user_key"]
        if valid_user(user_key):
          memcache_key = user_key + "##Cmds"
          cmds = memcache.get(memcache_key)
          if cmds is None:
            cmds = []
          cmds.append(data_json)
          memcache.set(memcache_key, cmds)
          response = "OK"
        else:
          self.error(401)
          response = "NO"
    except:
      logging.exception("Error updating Commands")
      self.error(500)
      response = "ERROR"
    self.response.headers['Content-Type'] = 'application/json'
    self.response.headers['Access-Control-Allow-Origin'] = '*'
    self.response.out.write(response)


class MainPage(webapp2.RequestHandler):
  def get(self):
    user_key = get_user_uuid(users.get_current_user())
    if user_key is not None:
      channel_id = channel.create_channel(user_key)
      status = memcache.get(user_key + "#" + "status")
      template_values = {
        'user_key': user_key,
        'user_uuid': uuid4(),
        'initial_status': status,
        'channel_id': channel_id
      }
      template = JINJA_ENVIRONMENT.get_template('/templates/keypad.html')
      template = template.render(template_values)
      self.response.headers['Content-Type'] = 'text/html'
      self.response.out.write(template)
    else:
      self.error(401)
      self.response.headers['Content-Type'] = 'text/html'
      self.response.out.write("NO")


class AddUser(webapp2.RequestHandler):
  def get(self):
    user = users.get_current_user()
    u = UserList()
    u.account = user
    u.uuid = str(uuid4())
    u.put()
    self.response.headers['Content-Type'] = 'text/plain'
    self.response.out.write("Added")


class NotFound(webapp2.RequestHandler):
  def get(self):
    self.error(404)
    self.response.headers['Content-Type'] = 'text/html'
    self.response.out.write("Not found.")


app = webapp2.WSGIApplication([
  ('/set/.*', SetData),
  ('/cmds/.*', Commands),
  ('/track/.*', TrackData),
  ('/get/.*', GetData),
  ('/door/.*', GetDoor),
  ('/state/.*', GetState),
  ('/', MainPage),
  ('/adduser', AddUser),
  ('.*', NotFound)], debug=False)
