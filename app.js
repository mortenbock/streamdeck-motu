var websocket;

// Updated from the global settings
const motuApiSettings = {
  host: 'localhost',
  port: '1280',
  device: undefined
}

// Cached device lists for the configured endpoints
const deviceLists = {};

// Generate random client id on startup
const motuClientId = Math.floor(Math.random() * (Math.pow(2, 31) - 1));

// Cached datastores for the known devices
const deviceDataStores = {};

// Utility to allow an async function to sleep. Used like: await sleep(1000)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function pollWorker() {
  let dataStoreEndpoint = '';
  let etag = undefined;

  while (true) {
    if (!(motuApiSettings.host && motuApiSettings.port && motuApiSettings.device)) {
      console.log('Api settings not complete', motuApiSettings);
      await sleep(5000);
      continue;
    }
    let currentDataStoreEndpoint = `http://${motuApiSettings.host}:${motuApiSettings.port}/${motuApiSettings.device}/datastore?client=${motuClientId}`;

    // If the endpoint changed, reset the values
    if (currentDataStoreEndpoint != dataStoreEndpoint) {
      dataStoreEndpoint = currentDataStoreEndpoint;
      etag = undefined;
    }

    try {
      const dataStorePollResponse = etag
        ? await fetch(dataStoreEndpoint, { 'headers': { 'cache-control': 'no-cache, no-store, max-age=0, must-revalidate', 'pragma': 'no-cache', 'if-none-match': etag } })
        : await fetch(dataStoreEndpoint, { 'headers': { 'cache-control': 'no-cache, no-store, max-age=0, must-revalidate', 'pragma': 'no-cache' } });

      if (dataStorePollResponse.status === 200) {
        etag = dataStorePollResponse.headers.get('ETag');
        const dataStorePayload = await dataStorePollResponse.json();

        if (deviceDataStores[dataStoreEndpoint] === undefined) {
          deviceDataStores[dataStoreEndpoint] = dataStorePayload;
        } else {
          Object.assign(deviceDataStores[dataStoreEndpoint], dataStorePayload);
        }
      }
    } catch (error) {
      console.error('Error while fetching datastore', error);
      await sleep(5000);
    }
  }
}

async function getMotuDevices(eventData) {

  const deviceCacheKey = `${motuApiSettings.host}_${motuApiSettings.port}`
  let deviceArray = deviceLists[deviceCacheKey];
  if (eventData.payload.isRefresh || deviceArray === undefined || deviceArray.length < 1) {
    const res = await fetch(`http://${motuApiSettings.host}:${motuApiSettings.port}/connected_devices`);
    deviceArray = await res.json();
    deviceLists[deviceCacheKey] = deviceArray;
  }

  const piItems = [];
  for (let index = 0; index < deviceArray.length; index++) {
    const element = deviceArray[index];
    piItems.push({ label: element.uid, value: element.uid });
  }

  const respEvent = {
    action: eventData.action,
    event: 'sendToPropertyInspector',
    context: eventData.context,
    payload: {
      event: 'getMotuDevices',
      items: piItems
    }
  };

  websocket.send(JSON.stringify(respEvent));
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

    switch (eventData.event) {
      case 'deviceDidConnect':
        websocket.send(JSON.stringify({ 'event': 'getGlobalSettings', 'context': uuid }));
        break;
      case 'didReceiveGlobalSettings':
        console.log('didReceiveGlobalSettings', eventData);

        const host = eventData?.payload?.settings?.motuapi?.host;
        motuApiSettings.host = host && host !== '' ? host : 'localhost';

        const port = eventData?.payload?.settings?.motuapi?.port
        motuApiSettings.port = port && port !== '' ? port : '1280';

        const device = eventData?.payload?.settings?.motuapi?.device
        motuApiSettings.device = device;

        break;
      case 'sendToPlugin':
        console.log('sendToPlugin', eventData);
        if (eventData.payload && eventData.payload.event === 'getMotuDevices') {
          getMotuDevices(eventData);
        }
        break;
      case 'willAppear':
      case 'didReceiveSettings':
        if (eventData.action === 'com.bocktown.motu.mute') {
          const channelIndex = eventData?.payload?.settings?.mixerChannelIndex;
          let actionTitle = '?';
          if (channelIndex === undefined || channelIndex === null || channelIndex === '') {
            actionTitle = 'N/A'
          } else {
            const dataStoreEndpoint = `http://${motuApiSettings.host}:${motuApiSettings.port}/${motuApiSettings.device}/datastore?client=${motuClientId}`;
            const dataStore = deviceDataStores[dataStoreEndpoint];
            if (!dataStore) break;
            const name = dataStore[`ext/obank/6/ch/${channelIndex}/name`];
            if (name?.length > 0) {
              actionTitle = name;
            } else {
              const defaultName = dataStore[`ext/obank/6/ch/${channelIndex}/defaultName`];
              actionTitle = defaultName;
            }
          }

          const setTitleCmd = {
            'event': 'setTitle',
            'context': eventData.context,
            'payload': {
              'title': actionTitle
            }
          };

          websocket.send(JSON.stringify(setTitleCmd));

        }
        break;
      case 'keyDown':
        if (eventData.action === 'com.bocktown.motu.mute') {
          const formData = new URLSearchParams();

          const channelIndex = eventData?.payload?.settings?.mixerChannelIndex;
          if (channelIndex === undefined || channelIndex === null || channelIndex === '') {
            //Channel not set up. Don't do anything.
            break;
          }

          const muteCmd = {};
          muteCmd[`mix/chan/${channelIndex}/matrix/mute`] = 1;

          const muteCmdJson = JSON.stringify(muteCmd);
          formData.append('json', muteCmdJson);

          fetch(`http://${motuApiSettings.host}:${motuApiSettings.port}/${motuApiSettings.device}/datastore?client=${motuClientId}`, {
            'body': formData,
            'method': 'POST'
          });
        }
        break;
      default:
        console.log(eventData);
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

  pollWorker();

}
