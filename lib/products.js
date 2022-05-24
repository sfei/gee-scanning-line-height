exports.get = function(options) {
  var process = require("{{repo}}:lib/process.js"), 
      palettes = require('users/gena/packages:palettes'), 
      viridisModified = require("{{repo}}:lib/palette-viridis-modified.js");
  
  options            = options || {};
  options.layers     = options.layers ? options.layers.map(function(n) { return n.toUpperCase(); }) : [];
  options.analyzeSLH = options.analyzeSLH || !!(~options.layers.indexOf("SLH"));
  options.analyzeChl = options.analyzeChl || !!(~options.layers.indexOf("CHL") || ~options.layers.indexOf("CHL2") || ~options.layers.indexOf("CHLOROPHYLL"));
  options.analyzeTSM = options.analyzeTSM || !!(~options.layers.indexOf("TSM"));
  options.analyzeFNU = (options.analyzeTurbidity || options.analyzeFNU) || !!(~options.layers.indexOf("FNU") || ~options.layers.indexOf("TURBIDITY"));
  if(options.pcdMask) {
    if(!options.analyzeSLH) {
      options.pcdMask = false;
    } else {
      if(!options.analyzeChl) options.analyzeChl = true;
      options.pcdOptions = options.pcdOptions || {};
    }
  }
  options.ndwiMask = options.ndwiMask === undefined || !!options.ndwiMask;
  options.cloudMask = options.cloudMask === undefined || !!options.cloudMask;
  
  return {
    slh: {
      name:      "SLH_MASK", 
      process:   options.analyzeSLH ? process.slh : false, 
      stats:     true, 
      symbology: {
        min: options.slhMin || 0, 
        max: options.slhMax || 300, 
        palette: viridisModified.palette
      }, 
      layername: "SLH"
    }, 
    chl: {
      name:      "CHL2_MASK", 
      process:   options.analyzeChl ? process.chl2 : false, 
      stats:     true, 
      symbology: {
        min: options.chlMin || 0, 
        max: options.chlMax || 150, 
        palette: palettes.colorbrewer.BuGn[7]
      }, 
      layername: "Chl-a"
    }, 
    pcd: {
      name:      "PCD", 
      process:   options.pcdMask ? process.pcd : false, 
      stats:     false, 
      symbology: {
        min: 0, 
        max: 2, 
        palette: palettes.misc.coolwarm[7]
      }, 
      layername: "PCD"
    }, 
    slh_pcd: {
      name:      "SLH_MASK_PCD", 
      process:   options.pcdMask, 
      stats:     true, 
      symbology: {
        min: options.slhMin || 0, 
        max: options.slhMax || 300, 
        palette: viridisModified.palette
      }, 
      layername: "SLH (w/ PCD)"
    }, 
    tsm: {
      name:      "TSM_MASK", 
      process:   options.analyzeTSM ? process.tsm665 : false, 
      stats:     true, 
      symbology: {
        min: options.tsmMin || 0, 
        max: options.tsmMax || 100, 
        palette: palettes.crameri.bilbao[10]
      }, 
      layername: "TSM"
    }, 
    fnu: {
      name:      "FNU_MASK", 
      process:   options.analyzeFNU ? process.fnu : false, 
      stats:     true, 
      symbology: {
        min: options.turbidityMin || 0, 
        max: options.turbidityMax || 100, 
        palette: palettes.crameri.bilbao[10]
      }, 
      layername: "FNU"
    }
  };
};