'use strict';

const configurationService = require('./configurationService');
const config = require('../config');

// Weather fetch — no RS-AIG amendment needed (unlike web_search/
// execute_code, nothing in RS-AIG-ai-governance.md ever prohibited this;
// it was simply never built). Same opt-in-per-college shape as every
// other external-provider tool in this file's own family
// (webRetrievalService.js, webSearchService.js, imageGenerationService.js).
// Provider: OpenWeatherMap (product decision). OPENWEATHER_API_KEY is
// not required() in config.js — this service throws its own
// WeatherNotConfiguredError at call time until it's set.

const CONFIG_CATEGORY = 'weather';
const FETCH_TIMEOUT_MS = 8000;

class WeatherNotConfiguredError extends Error {}
class WeatherNotEnabledError extends Error {}
class WeatherValidationError extends Error {}
class WeatherRequestError extends Error {}

async function getWeatherConfig(client, collegeId) {
  const row = await configurationService.getConfiguration(client, { collegeId, category: CONFIG_CATEGORY });
  const stored = row ? row.configuration : {};
  return { enabled: Boolean(stored.enabled) };
}

async function fetchCurrentWeather(client, collegeId, location) {
  if (!config.openWeatherApiKey) {
    throw new WeatherNotConfiguredError('weather fetch is not configured yet (OPENWEATHER_API_KEY unset)');
  }
  if (typeof location !== 'string' || !location.trim()) {
    throw new WeatherValidationError('location is required and must be a non-empty string');
  }

  const weatherConfig = await getWeatherConfig(client, collegeId);
  if (!weatherConfig.enabled) {
    throw new WeatherNotEnabledError('weather fetch is not enabled for this college — opt in via configuration first');
  }

  const url = new URL('https://api.openweathermap.org/data/2.5/weather');
  url.searchParams.set('q', location);
  url.searchParams.set('appid', config.openWeatherApiKey);
  url.searchParams.set('units', 'metric');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url.toString(), { signal: controller.signal });
  } catch (err) {
    throw new WeatherRequestError(`weather request failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new WeatherRequestError(`weather provider returned ${response.status}`);
  }
  const body = await response.json();
  return {
    location: body.name || location,
    description: body.weather && body.weather[0] ? body.weather[0].description : null,
    temperatureCelsius: body.main ? body.main.temp : null,
    humidityPercent: body.main ? body.main.humidity : null,
    windSpeedMetersPerSecond: body.wind ? body.wind.speed : null,
  };
}

module.exports = {
  WeatherNotConfiguredError,
  WeatherNotEnabledError,
  WeatherValidationError,
  WeatherRequestError,
  CONFIG_CATEGORY,
  getWeatherConfig,
  fetchCurrentWeather,
};
