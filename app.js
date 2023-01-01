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

// Known actions that need to be updated
const registeredActions = new Map();

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

        updateActions();
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
 * getChannels
 * Get list of channels to be selected by the user
 */
async function getChannels(eventData) {
  console.log('getChannels', eventData);
  const dataStoreEndpoint = `http://${motuApiSettings.host}:${motuApiSettings.port}/${motuApiSettings.device}/datastore?client=${motuClientId}`;
  const dataStore = deviceDataStores[dataStoreEndpoint];

  const piItems = [];

  if (dataStore) {
    for (const objKey of Object.keys(dataStore)) {
      const expr = /^ext\/obank\/6\/ch\/(\d+)\/defaultName$/;
      const match = expr.exec(objKey);
      if (match?.length > 0) {
        const channelIndex = match[1];
        const routingSource = dataStore[`ext/obank/6/ch/${channelIndex}/src`];
        if (routingSource) {
          const chFormat = dataStore[`mix/chan/${channelIndex}/config/format`];
          if (chFormat === '1:0' || chFormat === '2:0') {
            const chName = getChannelDisplayName(dataStore, channelIndex);
            piItems.push({ label: chName, value: channelIndex });
          }
        }
      }
    }
  }

  const respEvent = {
    action: eventData.action,
    event: 'sendToPropertyInspector',
    context: eventData.context,
    payload: {
      event: 'getChannels',
      items: piItems
    }
  };

  websocket.send(JSON.stringify(respEvent));

}

async function updateActions() {
  for (const action of registeredActions.values()) {
    updateAction(action);
  }
}

async function updateAction(eventData) {
  if (eventData.action === 'com.bocktown.motu.mute') {
    const channelIndex = eventData?.payload?.settings?.mixerChannelIndex;
    let actionTitle = '?';
    let actionState = 0;

    if (channelIndex === undefined || channelIndex === null || channelIndex === '') {
      actionTitle = 'N/A'
    } else {
      const dataStoreEndpoint = `http://${motuApiSettings.host}:${motuApiSettings.port}/${motuApiSettings.device}/datastore?client=${motuClientId}`;
      const dataStore = deviceDataStores[dataStoreEndpoint];
      if (!dataStore) return;

      //Update name
      actionTitle = getChannelDisplayName(dataStore, channelIndex);

      // Update state
      const muteChannelState = dataStore[`mix/chan/${channelIndex}/matrix/mute`];
      actionState = muteChannelState === 1 ? 1 : 0;
    }

    const setTitleCmd = {
      'event': 'setTitle',
      'context': eventData.context,
      'payload': {
        'title': actionTitle
      }
    };

    websocket.send(JSON.stringify(setTitleCmd));

    const setStateCmd = {
      'event': 'setState',
      'context': eventData.context,
      'payload': {
        'state': actionState
      }
    }

    websocket.send(JSON.stringify(setStateCmd));
  }
}

function getChannelDisplayName(dataStore, channelIndex) {
  const name = dataStore[`ext/obank/6/ch/${channelIndex}/name`];
  if (name?.length > 0) {
    const chFormat = dataStore[`mix/chan/${channelIndex}/config/format`];
    if (chFormat === "2:0") {
      const suffixRegEx = /(.*) L$/;
      const match = suffixRegEx.exec(name);
      if (match?.length > 0) {
        return match[1];
      }
      return name;
    }
    return name;
  } else {
    const defaultName = dataStore[`ext/obank/6/ch/${channelIndex}/defaultName`];
    return defaultName;
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
    switch (eventData.event) {
      case 'deviceDidConnect':
        websocket.send(JSON.stringify({ 'event': 'getGlobalSettings', 'context': uuid }));
        break;
      case 'didReceiveGlobalSettings':
        //console.log('didReceiveGlobalSettings', eventData);

        const host = eventData?.payload?.settings?.motuapi?.host;
        motuApiSettings.host = host && host !== '' ? host : 'localhost';

        const port = eventData?.payload?.settings?.motuapi?.port
        motuApiSettings.port = port && port !== '' ? port : '1280';

        const device = eventData?.payload?.settings?.motuapi?.device
        motuApiSettings.device = device;

        break;
      case 'sendToPlugin':
        if (eventData.payload) {
          if (eventData.payload.event === 'getMotuDevices') {
            getMotuDevices(eventData);
          } else if (eventData.payload.event === 'getChannels') {
            getChannels(eventData);
          }
        }
        break;
      case 'willAppear':
      case 'didReceiveSettings':
        registeredActions.set(eventData.context, eventData);
        updateAction(eventData);
        break;
      case 'willDisappear':
        registeredActions.delete(eventData.context);
        break;
      case 'keyDown':
        if (eventData.action === 'com.bocktown.motu.mute') {
          const formData = new URLSearchParams();

          const channelIndex = eventData?.payload?.settings?.mixerChannelIndex;
          if (channelIndex === undefined || channelIndex === null || channelIndex === '') {
            //Channel not set up. Don't do anything.
            break;
          }
          const dataStoreEndpoint = `http://${motuApiSettings.host}:${motuApiSettings.port}/${motuApiSettings.device}/datastore?client=${motuClientId}`;
          const dataStore = deviceDataStores[dataStoreEndpoint];
          // If datastore is not initialized, exit.
          if (!dataStore) break;

          const dataStoreKey = `mix/chan/${channelIndex}/matrix/mute`;
          const muteDataStoreTargetValue = eventData.payload.state === 0 ? 1 : 0;

          const muteCmd = {};
          muteCmd[dataStoreKey] = muteDataStoreTargetValue;

          const muteCmdJson = JSON.stringify(muteCmd);
          formData.append('json', muteCmdJson);

          fetch(dataStoreEndpoint, {
            'body': formData,
            'method': 'POST'
          }).then((r) => {
            if (r.status === 204) {
              // API call went well, update local data store.
              dataStore[dataStoreKey] = muteDataStoreTargetValue;
            }
          });
        }
        break;
      default:
        //console.log(eventData);
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
