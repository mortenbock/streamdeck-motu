/**
 * connectElgatoStreamDeckSocket
 * This is the first function StreamDeck Software calls, when
 * establishing the connection to the plugin or the Property Inspector
 * @param {string} port - The socket's port to communicate with StreamDeck software.
 * @param {string} uuid - A unique identifier, which StreamDeck uses to communicate with the plugin
 * @param {string} messageType - Identifies, if the event is meant for the property inspector or the plugin.
 * @param {string} appInfoString - Information about the host (StreamDeck) application
 * @param {string} actionInfo - Context is an internal identifier used to communicate to the host application.
 */
function connectElgatoStreamDeckSocket(port, uuid, messageType, appInfoString, actionInfo) {
  console.log(arguments);
  var websocket = new WebSocket("ws://localhost:" + port);

  websocket.onmessage = function (evt) {
    let eventData = JSON.parse(evt.data);
    console.log(eventData);
    switch (eventData.action) {
      case 'com.bocktown.motu.mute':
        console.log('was action');
        let eventType = eventData.event;
        switch (eventType) {
          case 'keyDown':
            console.log('Time to mute');
            const formData = new URLSearchParams();

            const muteCmd = JSON.stringify({'mix/chan/0/matrix/mute': 1});
            formData.append('json', muteCmd);            
            
            fetch("http://localhost:1280/0001f2fffe00bd94/datastore?client=1420185306", {
              "body": formData,
              "method": "POST"
            });
            break;

          default:
            break;
        }
        break;

      default:
        break;
    }
  }

  websocket.onopen = function () {
    // WebSocket is connected, register the plugin
    var json = {
      "event": messageType,
      "uuid": uuid
    };

    websocket.send(JSON.stringify(json));
  };
}


// fetch("http://localhost:1280/0001f2fffe00bd94/datastore?client=1420185305", {
//   "headers": {
//     "accept": "*/*",
//     "accept-language": "en-US,en;q=0.9,da-DK;q=0.8,da;q=0.7",
//     "cache-control": "no-cache",
//     "content-type": "multipart/form-data; boundary=----WebKitFormBoundarywEhMb0P47BpCzrij",
//     "pragma": "no-cache",
//     "sec-ch-ua": "\"Not?A_Brand\";v=\"8\", \"Chromium\";v=\"108\", \"Google Chrome\";v=\"108\"",
//     "sec-ch-ua-mobile": "?0",
//     "sec-ch-ua-platform": "\"Windows\"",
//     "sec-fetch-dest": "empty",
//     "sec-fetch-mode": "cors",
//     "sec-fetch-site": "same-origin"
//   },
//   "referrer": "http://localhost:1280/0001f2fffe00bd94/",
//   "referrerPolicy": "strict-origin-when-cross-origin",
//   "body": "------WebKitFormBoundarywEhMb0P47BpCzrij\r\nContent-Disposition: form-data; name=\"json\"\r\n\r\n{\"mix/chan/0/matrix/mute\":0}\r\n------WebKitFormBoundarywEhMb0P47BpCzrij--\r\n",
//   "method": "POST",
//   "mode": "cors",
//   "credentials": "omit"
// });