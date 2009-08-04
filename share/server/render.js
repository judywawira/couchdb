// Licensed under the Apache License, Version 2.0 (the "License"); you may not
// use this file except in compliance with the License. You may obtain a copy of
// the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations under
// the License.

var respCT;
var respTail;
// this function provides a shortcut for managing responses by Accept header
respondWith = function(req, responders) {
  var bestKey = null, accept = req.headers["Accept"];
  if (accept && !req.query.format) {
    var provides = [];
    for (key in responders) {
      if (mimesByKey[key]) {
        provides = provides.concat(mimesByKey[key]);
      }
    }
    var bestMime = Mimeparse.bestMatch(provides, accept);
    bestKey = keysByMime[bestMime];
  } else {
    bestKey = req.query.format;
  }
  var rFunc = responders[bestKey || responders.fallback || "html"];
  if (rFunc) {
    if (isShow) {
      var resp = maybeWrapResponse(rFunc());
      resp["headers"] = resp["headers"] || {};
      resp["headers"]["Content-Type"] = bestMime;
      respond(["resp", resp]);
    } else {
      respCT = bestMime;
      respTail = rFunc();
    }
  } else {
    throw({code:406, body:"Not Acceptable: "+accept});
  }
};

// whoever registers last wins.
mimesByKey = {};
keysByMime = {};
registerType = function() {
  var mimes = [], key = arguments[0];
  for (var i=1; i < arguments.length; i++) {
    mimes.push(arguments[i]);
  };
  mimesByKey[key] = mimes;
  for (var i=0; i < mimes.length; i++) {
    keysByMime[mimes[i]] = key;
  };
};

// Some default types
// Ported from Ruby on Rails
// Build list of Mime types for HTTP responses
// http://www.iana.org/assignments/media-types/
// http://dev.rubyonrails.org/svn/rails/trunk/actionpack/lib/action_controller/mime_types.rb

registerType("all", "*/*");
registerType("text", "text/plain; charset=utf-8", "txt");
registerType("html", "text/html; charset=utf-8");
registerType("xhtml", "application/xhtml+xml", "xhtml");
registerType("xml", "application/xml", "text/xml", "application/x-xml");
registerType("js", "text/javascript", "application/javascript", "application/x-javascript");
registerType("css", "text/css");
registerType("ics", "text/calendar");
registerType("csv", "text/csv");
registerType("rss", "application/rss+xml");
registerType("atom", "application/atom+xml");
registerType("yaml", "application/x-yaml", "text/yaml");

// just like Rails
registerType("multipart_form", "multipart/form-data");
registerType("url_encoded_form", "application/x-www-form-urlencoded");

// http://www.ietf.org/rfc/rfc4627.txt
registerType("json", "application/json", "text/x-json");




//  Start chunks
var startResp = {};
function start(resp) {
  startResp = resp || {};
};

function sendStart(label) {
  startResp = startResp || {};
  startResp["headers"] = startResp["headers"] || {};
  startResp["headers"]["Content-Type"] = startResp["headers"]["Content-Type"] || respCT;

  respond(["start", chunks, startResp]);
  chunks = [];
  startResp = {};
}
//  Send chunk
var chunks = [];
function send(chunk) {
  chunks.push(chunk.toString());
};

function blowChunks(label) {
  respond([label||"chunks", chunks]);
  chunks = [];
};

var gotRow = false, lastRow = false;
function getRow() {
  if (lastRow) return null;
  if (!gotRow) {
    gotRow = true;
    sendStart();
  } else {
    blowChunks()
  }
  var line = readline();
  var json = eval(line);
  if (json[0] == "list_end") {
    lastRow = true
    return null;
  }
  if (json[0] != "list_row") {
    respond({
      error: "query_server_error",
      reason: "not a row '" + json[0] + "'"});
    quit();
  }
  return json[1];
};

////
////  Render dispatcher
////
////
////
////
var isShow = false;
var Render = (function() {
  var row_info;

  return {
    show : function(funSrc, doc, req) {
      isShow = true;
      var formFun = compileFunction(funSrc);
      runShowRenderFunction(formFun, [doc, req], funSrc, true);
    },
    list : function(head, req) {
      isShow = false;
      runListRenderFunction(funs[0], [head, req], funsrc[0], false);
    }
  }
})();

function maybeWrapResponse(resp) {
  var type = typeof resp;
  if ((type == "string") || (type == "xml")) {
    return {body:resp};
  } else {
    return resp;
  }
};

function runShowRenderFunction(renderFun, args, funSrc, htmlErrors) {
  try {
    var resp = renderFun.apply(null, args);
    if (resp) {
      respond(["resp", maybeWrapResponse(resp)]);
    } else {
      renderError("undefined response from render function");
    }
  } catch(e) {
    respondError(e, funSrc, htmlErrors);
  }
};
function runListRenderFunction(renderFun, args, funSrc, htmlErrors) {
  try {
    gotRow = false;
    lastRow = false;
    respTail = "";
    if (renderFun.arity > 2) {
      throw("the list API has changed for CouchDB 0.10, please upgrade your code");
    }
    var resp = renderFun.apply(null, args);
    if (!gotRow) {
      getRow();
    }
    if (typeof resp != "undefined") {
      chunks.push(resp);
    } else if (respTail) {
      chunks.push(respTail);
    }
    blowChunks("end");
  } catch(e) {
    respondError(e, funSrc, htmlErrors);
  }
};

function renderError(m) {
  respond({error : "render_error", reason : m});
}


function respondError(e, funSrc, htmlErrors) {
  var logMessage = "function raised error: "+e.toString();
  log(logMessage);
  log("stacktrace: "+e.stack);
  var errorMessage = htmlErrors ? htmlRenderError(e, funSrc) : logMessage;
  respond({
    error:"render_error",
    reason:errorMessage});
}

function escapeHTML(string) {
  return string.replace(/&/g, "&amp;")
               .replace(/</g, "&lt;")
               .replace(/>/g, "&gt;");
}

function htmlRenderError(e, funSrc) {
  var msg = ["<html><body><h1>Render Error</h1>",
    "<p>JavaScript function raised error: ",
    e.toString(),
    "</p><h2>Stacktrace:</h2><code><pre>",
    escapeHTML(e.stack),
    "</pre></code><h2>Function source:</h2><code><pre>",
    escapeHTML(funSrc),
    "</pre></code></body></html>"].join('');
  return {body:msg};
};

