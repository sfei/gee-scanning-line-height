exports.analyze = function(roi, targetDate, options) {
  // default options
  options            = options || {};
  options.searchDays = options.searchDays || 4;
  options.pixelScale = options.pixelScale || 20;
  options.srs        = options.srs || "EPSG:3310";
  options.layers     = options.layers || ["slh", "chl", "fnu"];
  
  Map.centerObject(roi);
  
  // query images
  targetDate = ee.Date(targetDate);
  var collection = ee.ImageCollection(options.useTOA ? "COPERNICUS/S2" : "COPERNICUS/S2_SR")
        .filterDate(
          targetDate.advance(-options.searchDays, 'day').format("YYYY-MM-dd"), 
          targetDate.advance(options.searchDays, 'day').format("YYYY-MM-dd")
        )
        .filterBounds(roi)
        .map(function(image) {
          var index = ee.String(image.get("system:index")), 
              year = index.slice(0,4), 
              month = index.slice(4,6), 
              day = index.slice(6,8), 
              thisDate = ee.Date(year.cat("-").cat(month).cat("-").cat(day));
          return image.set('date', thisDate)
                      .set('diff', ee.Number(targetDate.difference(thisDate, 'day')).abs());
        })
        .sort('diff', true);
  print('Image results: ', collection);
  
  // get latest image with largest footprint
  var nearestDate = ee.Date(collection.first().get('date')), 
      nearestDateStr = nearestDate.format("YYYY-MM-dd").getInfo();
  print("Nearest Date: ", nearestDate);
  collection = collection
    .filter(ee.Filter.eq('date', nearestDate))
    .map(function(image) {
      var footprint = ee.Geometry(image.get("system:footprint")).bounds();
      return image.set('intersection', footprint.intersection(roi, 10).area().round());
    })
    .sort('intersection', false);
  print('Image results filtered: ', collection);
  var first = collection.first();
  print("Image selected: ", first);
  
  // get imports, params, and products list
  var process = require("{{repo}}:lib/process.js"), 
      products = require("{{repo}}:lib/products.js").get(options), 
      doSubAreasStats = options.subareas && options.subareaNameField;
  
  // raster vars
  var rasters = {}, 
      mask = false, 
      slh = false, 
      chl = false, 
      pcd = false;
      
  // process on analysis-level
  if(doSubAreasStats || options.analysisLevel) {
    var image     = first.reproject(options.srs, null, options.pixelScale)
                         .clipToCollection(options.subareas || roi), 
        ndwi      = options.ndwiMask ? process.ndwi(image).gt(0) : false, 
        cloudMask = options.cloudMask ? process.cloudMask(image) : false;
        mask      = ndwi ? (cloudMask ? ndwi.and(cloudMask) : ndwi) : cloudMask;
    rasters = {
      TRUECOLOR: image, 
      SLH_RAW: false
    };
    for(var key in products) {
      if(!products[key].process) continue;
      var pname = products[key].name, 
          rname = key.toUpperCase(), 
          processed;
      if(pname === "PCD") {
        if(!slh || !chl) continue;
        processed = products[key].process(slh, chl, options.pcdOptions);
        if(mask) processed = processed.mask(mask);
        pcd = processed;
      } else if(pname === "SLH_MASK_PCD") {
        if(!pcd) continue;
        processed = slh.mask(pcd.lt(1));
        // replace SLH, move original as raw
        rasters.SLH_RAW = rasters.SLH;
        rname = "SLH";
      } else {
        processed = products[key].process(image);
        if(mask) processed = processed.mask(mask);
        switch(pname) {
          case "SLH_MASK":
            slh = processed;
            break;
          case "CHL2_MASK":
          case "CHL3_MASK":
            chl = processed;
            break;
        }
      }
      if(processed) rasters[rname] = processed;
    }
  }
  
  if(doSubAreasStats) { 
    var reducer = ee.Reducer.count()
          .combine({
            reducer2: ee.Reducer.mean(),
            sharedInputs: true
          })
          .combine({
            reducer2: ee.Reducer.median(),
            sharedInputs: true
          }), 
        reducer2 = reducer
          .combine({
            reducer2: ee.Reducer.percentile([90]),
            sharedInputs: true
          }), 
      statsSLHRaw, 
      statsSLH, 
      statsChl, 
      statsFNU, 
      statsTSM;
    
    if(rasters.SLH) {
      statsSLH = rasters.SLH.reduceRegions({
        collection: options.subareas, 
        reducer: reducer2, 
        scale: options.pixelScale
      });
      if(rasters.SLH_RAW) {
        statsSLHRaw = rasters.SLH_RAW.reduceRegions({
          collection: options.subareas, 
          reducer: reducer2, 
          scale: options.pixelScale
        });
      }
    }
    if(rasters.CHL) {
        statsChl = rasters.CHL.reduceRegions({
          collection: options.subareas, 
          reducer: reducer, 
          scale: options.pixelScale
        })
    }
    if(rasters.FNU) {
      statsFNU = rasters.FNU.reduceRegions({
        collection: options.subareas, 
        reducer: reducer, 
        scale: options.pixelScale
      });
    }
    if(rasters.TSM) {
      statsTSM = rasters.TSM.reduceRegions({
        collection: options.subareas, 
        reducer: reducer, 
        scale: options.pixelScale
      });
    }
    
    var statsPC = statsSLH;
    if(options.minPixelCount) {
      var filterPC = ee.Filter.gte('count', options.minPixelCount);
      statsSLH = statsSLH.filter(filterPC);
      if(statsSLHRaw) statsSLHRaw = statsSLHRaw.filter(filterPC);
      if(statsChl) statsChl = statsChl.filter(filterPC);
      if(statsTSM) statsTSM = statsTSM.filter(filterPC);
      if(statsFNU) statsFNU = statsFNU.filter(filterPC);
    }
    
    if(statsSLHRaw) {
      var chartSLHRaw = ui.Chart.feature.byFeature(statsSLHRaw, options.subareaNameField, ['mean', 'median', 'p90'])
        .setChartType('ScatterChart')
        .setOptions({
          title: 'SLH [raw] ('+nearestDateStr+')',
          hAxis: {title: 'Subarea name'},
          vAxis: {title: 'SLH (x10,000)'}
        });
      print(chartSLHRaw);
    }
    if(statsSLH) {
      var chartSLH = ui.Chart.feature.byFeature(statsSLH, options.subareaNameField, ['mean', 'median', 'p90'])
        .setChartType('ScatterChart')
        .setOptions({
          title: 'SLH ('+nearestDateStr+')',
          hAxis: {title: 'Subarea name'},
          vAxis: {title: 'SLH (x10,000)'}
        });
      print(chartSLH);
    }
    
    if(statsChl) {
      var chartChl = ui.Chart.feature.byFeature(statsChl, options.subareaNameField, ['mean', 'median'])
        .setChartType('ScatterChart')
        .setOptions({
          title: 'Chlorophyll-a ('+nearestDateStr+')',
          hAxis: {title: 'Subarea name'},
          vAxis: {title: 'mg/m^3'}
        });
      print(chartChl);
    }
    
    if(statsFNU) {
      var chartFNU = ui.Chart.feature.byFeature(statsTurbidity, options.subareaNameField, ['mean', 'median'])
        .setChartType('ScatterChart')
        .setOptions({
          title: 'Turbidity FNU ('+nearestDateStr+')',
          hAxis: {title: 'Subarea name'},
          vAxis: {title: 'FNU'}
        });
      print(chartFNU);
    }
    
    if(statsTSM) {
      var chartTSM = ui.Chart.feature.byFeature(statsTSM, options.subareaNameField, ['mean', 'median'])
        .setChartType('ScatterChart')
        .setOptions({
          title: 'Turbidity TSM ('+nearestDateStr+')',
          hAxis: {title: 'Subarea name'},
          vAxis: {title: 'g/m^3'}
        });
      print(chartTSM);
    }
    
    var chartPc = ui.Chart.feature.byFeature(statsPC, options.subareaNameField, 'count')
      .setChartType('ScatterChart')
      .setOptions({
        title: 'Pixel Counts ('+nearestDateStr+')',
        hAxis: {title: 'Subarea name'},
        vAxis: {title: 'Pixel count'}
      });
    print(chartPc);
  }
  
  if(options.noDisplay) return rasters;
  
  // [redo] analysis at default map scale and projection for display
  if(!mask) {
    var ndwi      = options.ndwiMask ? process.ndwi(first).gt(0) : false, 
        cloudMask = options.cloudMask ? process.cloudMask(first) : false, 
        mask      = ndwi ? (cloudMask ? ndwi.and(cloudMask) : ndwi) : cloudMask;
  }
  rasters.TRUECOLOR = first;
  for(var key in products) {
    if(!products[key].process) continue;
    var pname = products[key].name, 
        rname = key.toUpperCase(), 
        processed = false;
    if(pname === "PCD") {
      if(!pcd) {
        if(!slh || !chl) continue;
        processed = products[key].process(slh, chl, options.pcdOptions);
        if(mask) processed = processed.mask(mask);
        pcd = processed;
      }
    } else if(pname === "SLH_MASK_PCD") {
      if(!slh) {
        if(!pcd) continue;
        processed = slh.mask(pcd.lt(1));
        // replace SLH, move original as raw
        rasters.SLH_RAW = rasters.SLH;
      }
      rname = "SLH";
    } else if(!rasters[rname]) {
      processed = products[key].process(first);
      if(mask) processed = processed.mask(mask);
      switch(pname) {
        case "SLH_MASK":
          slh = processed;
          break;
        case "CHL2_MASK":
        case "CHL3_MASK":
          chl = processed;
          break;
      }
    }
    if(processed) rasters[rname] = processed;
  }
  
  if(options.exportImages) {
    options.exportScale = options.exportScale || 40;
    options.exportRoi = options.exportRoi || options.exportROI;
  }
  
  var l2aImg = first.visualize({bands: ['B4', 'B3', 'B2'], min: 0, max: 3000})
  Map.addLayer(
    l2aImg, 
    {},  
    "True Color ("+nearestDateStr+")", 
    true, 0.8
  );
  if(options.exportImages) {
    Export.image.toDrive({
      image: l2aImg,
      description: nearestDateStr+"_TRUECOLOR", 
      scale: options.exportScale, 
      region: options.exportRoi
    });
  }
  var displayOrder = [
    ["tsm", "TSM"], 
    ["fnu", "FNU"], 
    ["chl", "CHL", "Chl-a"], 
    ["pcd", "PCD", "PCD normalized"], 
    ["slh", "SLH_RAW", "SLH [raw]"], 
    ["slh_pcd", "SLH"], 
  ];
  for(var i = 0; i < displayOrder.length; ++i) {
    var pkey  = displayOrder[i][0], 
        rkey  = displayOrder[i][1], 
        label = displayOrder[i].length > 2 ? displayOrder[i][2] : rkey;
    if(!rasters[rkey]) continue;
    var img = rasters[rkey].visualize(products[pkey].symbology);
    Map.addLayer(
      img, 
      {}, 
      label + " ("+nearestDateStr+")", 
      rkey == "SLH", 1
    );
    if(options.exportImages) {
      Export.image.toDrive({
        image: img,
        description: nearestDateStr+"_"+rkey, 
        scale: options.exportScale, 
        region: options.exportRoi
      });
    }
  }
  
  return rasters;
};