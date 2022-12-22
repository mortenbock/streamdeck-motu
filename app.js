var websocket;

const motuBaseUrl = 'http://localhost:1280';
// Generate random client id on startup
const motuClientId = Math.floor(Math.random() * (Math.pow(2, 31) - 1));
const deviceDataStores = {};

async function longPollDevice(deviceId) {

  const initialDatastoreResponse = await fetch(`${motuBaseUrl}/${deviceId}/datastore?client=${motuClientId}`, {
    'headers': {
      'cache-control': 'no-cache, no-store, max-age=0, must-revalidate'
    }
  });

  deviceDataStores[deviceId] = await initialDatastoreResponse.json();
  let etag = initialDatastoreResponse.headers.get('ETag');

  while (true) {
    const dataStoreUpdateResponse = await fetch(`${motuBaseUrl}/${deviceId}/datastore?client=${motuClientId}`, {
      'headers': {
        "cache-control": "no-cache, no-store, max-age=0, must-revalidate",
        "if-none-match": etag,
        "pragma": "no-cache"
      }
    });

    // Status 200: Something changed: Update state and etag
    // Status 304: Nothing changed. Keep polling
    // Others, log error and keep polling (Maybe back off?)

    if(dataStoreUpdateResponse.status === 200){
      etag = dataStoreUpdateResponse.headers.get('ETag');
      const dataStoreUpdate = await dataStoreUpdateResponse.json();
      Object.assign(deviceDataStores[deviceId], dataStoreUpdate);
    }
  }
}

async function setupDevicePolling() {
  var devicesResponse = await fetch(`${motuBaseUrl}/connected_devices`);

  if (devicesResponse.status !== 200) {
    console.error('Error fetching device list', devicesResponse);
    return;
  }

  const deviceArray = await devicesResponse.json();
  for (let index = 0; index < deviceArray.length; index++) {
    const deviceItem = deviceArray[index];
    longPollDevice(deviceItem.uid);
  }
}


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
  websocket = new WebSocket('ws://localhost:' + port);

  websocket.onmessage = function (evt) {
    let eventData = JSON.parse(evt.data);
    switch (eventData.action) {
      case 'com.bocktown.motu.mute':
        let eventType = eventData.event;
        switch (eventType) {
          case 'keyDown':
            const formData = new URLSearchParams();

            const muteCmd = JSON.stringify({ 'mix/chan/0/matrix/mute': 1 });
            formData.append('json', muteCmd);

            fetch('http://localhost:1280/0001f2fffe00bd94/datastore?client=1420185306', {
              'body': formData,
              'method': 'POST'
            });

            var updateEvt = {
              'event': 'setTitle',
              'context': eventData.context,
              'payload': {
                'title': 'Chan 0'
              }
            };

            websocket.send(JSON.stringify(updateEvt));

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
      'event': messageType,
      'uuid': uuid
    };

    websocket.send(JSON.stringify(json));
  };

  setupDevicePolling();

}


// fetch("http://localhost:1280/0001f2fffe00bd94/datastore?client=1046255244", {
//   "headers": {
//     "accept": "*/*",
//     "accept-language": "en-US,en;q=0.9,da-DK;q=0.8,da;q=0.7",
//     "cache-control": "no-cache, no-store, max-age=0, must-revalidate",
//     "expires": "0",
//     "if-none-match": "5294",
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
//   "body": null,
//   "method": "GET",
//   "mode": "cors",
//   "credentials": "omit"
// });