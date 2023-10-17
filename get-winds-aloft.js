const fetch = require("node-fetch");
const $ = require("cheerio");
const moment = require("moment");

const cacheManager = require("cache-manager");
const memoryCache = cacheManager.caching({
  store: "memory",
  max: 100,
  ttl: 60 * 5 /* 5 minutes */,
});

module.exports = (req, res) => {
  const region = req.params.region;
  const station = req.params.station;

  return memoryCache
    .wrap(region, () => {
      console.log(region);
      const url = `https://aviationweather.gov/api/data/windtemp?level=low&fcst=06&region=${region}&layout=off&date=`;
      console.log(url);
      return fetch(url).then(response => response.text());
    })
    .then(html => parse(html, station))
    .then(data => {
      return { region, station, ...data };
    });
};

const parse = (html, station) => {
  // let data = parseText(extractText(html));
  let data = parseText(html);
  data.dataRows.pop(); // junk row
  data.dataRows = mapByStation(data.dataRows);
  data.dataRows = addReadableForecasts(data.dataRows);
  if (station) {
    data.dataRows = data.dataRows.filter(row => row.station === station);
  }
  return data;
};

const extractText = html => {
  return $("pre", html).text();
};

const parseText = text => {
  const rows = text.split(/\n/);
  console.log(text);
  [extFromLine, notSure, dataBasedOnLine, validFromLine, _, keys, ...rest] = [
    ...rows,
  ];
  const dataBasedOn = dataBasedOnLine.match(/([\d]+Z)/)[1];
  const valid = validFromLine.match(/VALID ([\w]+Z)/)[1];
  const forUse = validFromLine.match(/FOR USE ([\d]{4}-[\d]{4}Z)/)[1];
  const result = {
    dataBasedOn,
    valid,
    forUse,
    // keys,
    dataRows: rest,
  };
  return result;
};

const mapByStation = dataRows => {
  return dataRows.map(row => {
    [station, ...rest] = [...row.split(/\s/)];
    return { station, rawForecast: rest.slice(0, 4) };
  });
};

const addReadableForecasts = dataRows => {
  return dataRows.map(row => {
    return {
      ...row,
      forecast: parseForecast(row.rawForecast),
    };
  });
};

const parseForecast = rawForecast => {
  return rawForecast
    .map((altitudeForecast, i) => {
      let altitude;
      switch (i) {
        case 0:
          altitude = 3000;
          break;
        case 1:
          altitude = 6000;
          break;
        case 2:
          altitude = 9000;
          break;
        case 3:
          altitude = 12000;
          break;
      }
      const result = {
        altitudeForecast,
        altitude: altitude,
        direction: getDirection(altitudeForecast),
        speed: getSpeed(altitudeForecast),
        temperature: getTemperature(altitudeForecast),
      };
      if (altitude === 3000) {
        // temperature is not reported at 3k, just so ya know
        delete result.temperature;
      }
      return result;
    })
    .reverse();
};

const getDirection = altitudeForecast => {
  let dirVal = Number(altitudeForecast.slice(0, 2)) * 10;
  if (dirVal === 990) {
    dirVal = "L/V";
  } else if (dirVal > 400) {
    dirVal = dirVal - 500;
  }
  return dirVal;
};

const getSpeed = altitudeForecast => {
  const dirVal = Number(altitudeForecast.slice(0, 2)) * 10;
  let knots = Number(altitudeForecast.slice(2, 4));
  if (dirVal > 400) {
    knots += 100;
  }
  if (dirVal === 990) {
    knots = 0;
  }
  return {
    knots,
    mph: Math.round(knots * 1.151),
  };
};

const getTemperature = altitudeForecast => {
  let celsius = Number(altitudeForecast.slice(4, 7));
  return {
    celsius,
    farenheit: Math.round((celsius * 9) / 5 + 32),
  };
};
