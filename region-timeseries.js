var roi = /* GEE FeatureCollection reference on map */;

var timeseries = require("{{repo}}:lib/timeseries.js");

// stats to process (recognized values: 'all', 'mean', 'median', 'p90')
var stats = ["mean", "median", "p90"];
// analysis options
var options = {
  // force analysis in UTM 10N (should be what imagery is originally captured in for NorCal).
  srs: "EPSG:32610", 
  // Sentinel-2 bands used are 10-20m resolution, but you may need to downsample if GEE exceeds capacity.
  pixelScale: 20, 
  // Filter results by minimum number of pixels per zone per capture.
  minPixelCount: 0, 
  // Alternatively, provide min area in hectares (minPixelCount takes precedence unless it's null or 0).
  minPixelHa: 12, 
  // Set true to use top-of-atmosphere (not atmospherically corrected), which data goes back longer, but 
  // probably messes up chlorophyll and turbidity algorithms.
  useTOA: false, 
  // Ignore dates where there's smoke/haze over entire image but not enough to trigger  NDWI or cloud mask to 
  // ignore, affecting SLH values. Format as array of "yyyy-mm-dd"
  ignoreDates: [], 
  // Estimate chlorophyll-a.
  analyzeChl: false, 
  // Estimate turbidity (FNU).
  analyzeFNU: false, 
  // Estimate total suspended materials (TSM).
  analyzeTSM: false,
  // Create task to download all images.
  exportImages: false, 
  // Export image pixel size (min 10, defaults to 30 if null or 0).
  exportScale: 20, 
  // Export image extent (or set false for same as viewport).
  exportRoi: roi
};
// max cloudy percentage (0-100), leave 0 for no filter.
var maxCloudyPerc = 0;
// start and end dates (yyyy-mm-dd format).
var startDate = "2020-06-01", 
    endDate   = "2020-11-01";

// grab imagery
var imagery = timeseries.images(roi, startDate, endDate, maxCloudyPerc, options.useTOA);
// display images map (comment out if unneeded as can be expensive and slow down script)
//timeseries.display(imagery, options);
// analyze data
var results = timeseries.analyze(imagery, roi, options, stats);
// chart data
timeseries.chartBasic(results, stats);