var fimages = function(roi, startDate, endDate, maxCloudyPerc, useTOA) {
  var collection = ee.ImageCollection(useTOA ? "COPERNICUS/S2" : "COPERNICUS/S2_SR")
    .filterDate(
      ee.Date(startDate).format("YYYY-MM-dd"), 
      ee.Date(endDate).format("YYYY-MM-dd")
    );
  if(maxCloudyPerc) {
    collection = collection.filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', maxCloudyPerc));
  }
  collection = collection
    .filterBounds(roi)
    .map(function(image) {
      var index = ee.String(image.get("system:index")), 
          year = index.slice(0,4), 
          month = index.slice(4,6), 
          day = index.slice(6,8), 
          footprint = ee.Geometry(image.get("system:footprint")).bounds();
      return image
        .set('date', ee.Date(year.cat("-").cat(month).cat("-").cat(day)))
        .set('intersection', footprint.intersection(roi, 10).area().round());
    })
    .sort('intersection', false);
  print('Image results: ', collection);
  
  // filter by tile corresponding to largest intersection
  var first = collection.first(), 
      intersection = ee.String(first.get('MGRS_TILE'));
  collection = collection
    .filter(ee.Filter.eq('MGRS_TILE', intersection))
    .sort('date', true);
  print('Image results filtered: ', collection);
  
  return collection;
};

exports.images = fimages;

exports.imagesTOA = function(roi, startDate, endDate, maxCloudyPerc) {
  return fimages(roi, startDate, endDate, maxCloudyPerc, true);
};

exports.imagesBOA = function(roi, startDate, endDate, maxCloudyPerc) {
  return fimages(roi, startDate, endDate, maxCloudyPerc);
};

exports.display = function(collection, options) {
  options = options || {};
  options.analyzeSLH = typeof options.analyzeSLH === "undefined" || options.analyzeSLH;
  if(options.exportImages) {
    if(!options.exportScale || options.exportScale <= 0) {
      options.exportScale = 30;
    } else if(options.exportScale < 10) {
      options.exportScale = 10;
    }
    options.exportRoi = options.exportRoi || undefined;
  }
  
  var process = require("{{repo}}:lib/process.js"), 
      products = require("{{repo}}:lib/products.js").get(options);
  
  // create products
  collection = collection.map(function(image) {
    var ndwi      = options.ndwiMask ? process.ndwi(image).gt(0) : false, 
        cloudMask = options.cloudMask ? process.cloudMask(image) : false, 
        mask      = ndwi ? (cloudMask ? ndwi.and(cloudMask) : ndwi) : cloudMask, 
        slh       = false, 
        chl       = false, 
        pcd       = false;
    for(var key in products) {
      if(!products[key].process) continue;
      var pname = products[key].name, 
          processed;
      if(pname === "PCD") {
        if(!slh || !chl) continue;
        processed = products[key].process(slh, chl, options.pcdOptions);
        if(mask) processed = processed.mask(mask);
        pcd = processed;
      } else if(pname === "SLH_MASK_PCD") {
        if(!pcd) continue;
        processed = slh.mask(pcd.lt(1));
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
      image = image.addBands(processed.rename(pname));
    }
    return image;
  });
  
  // collections by product and convert to lists
  var prdLists = {}, 
      count = 0;
  for(var key in products) {
    if(!products[key].process) continue;
    var pCollection = collection.select(products[key].name);
    count = pCollection.size().getInfo();
    prdLists[key] = pCollection.toList(count);
  }
  var colList = collection.toList(count);
  
  if(options.exportImages) {
    options.exportScale = options.exportScale || 40;
    options.exportRoi = options.exportRoi || options.exportROI;
  }
  
  for(var i = 0; i < count; ++i) {
    var l2aImg = ee.Image(colList.get(i)), 
        date   = ee.Date(l2aImg.get("date"));
    l2aImg = l2aImg.visualize({bands: ['B4', 'B3', 'B2'], min: 0, max: 3000})
    Map.addLayer(
      l2aImg, 
      {},  
      date.format("YYYY-MM-dd").cat(" True Color").getInfo(), 
      false, 1
    );
    if(options.exportImages) {
      Export.image.toDrive({
        image: l2aImg,
        description: date.format("YYYY-MM-dd").cat(" True Color").getInfo(), 
        scale: options.exportScale, 
        region: options.exportRoi
      });
    }
    for(var key in prdLists) {
      var img = ee.Image(prdLists[key].get(i)).visualize(products[key].symbology);
      Map.addLayer(
        img, 
        {}, 
        date.format("YYYY-MM-dd").cat("_"+products[key].layername).getInfo(), 
        false, 1
      );
      if(options.exportImages) {
        Export.image.toDrive({
          image: img,
          description: date.format("YYYY-MM-dd").cat("_"+products[key].layername).getInfo(), 
          scale: options.exportScale, 
          region: options.exportRoi
        });
      }
    }
  }
};

exports.analyze = function(collection, zones, options, stats) {
  options            = options || {};
  options.pixelScale = options.pixelScale || 20;
  options.srs        = options.srs || "EPSG:3310";
  options.analyzeSLH = typeof options.analyzeSLH === "undefined" || options.analyzeSLH;
  
  var process = require("{{repo}}:lib/process.js"), 
      products = require("{{repo}}:lib/products.js").get(options);
      
  if(options.ignoreDates) {
    for(var i = 0; i < options.ignoreDates.length; ++i) {
      var date = ee.Date(options.ignoreDates[i]), 
          date1 = date.advance(0, 'hour'), 
          date2 = date.advance(24, 'hour');
      collection = collection.filter(ee.Filter.date(date1, date2).not());
    }
  }
  
  var reducer = ee.Reducer.count(), 
      allStats = ~stats.indexOf("all");
  if(allStats || ~stats.indexOf("median")) {
    reducer = reducer.combine({
      reducer2: ee.Reducer.median(),
      sharedInputs: true
    });
  }
  if(allStats || ~stats.indexOf("mean")) {
    reducer = reducer.combine({
      reducer2: ee.Reducer.mean(),
      sharedInputs: true
    });
  }
  if(allStats || ~stats.indexOf("p90")) {
    reducer = reducer.combine({
      reducer2: ee.Reducer.percentile([90]),
      sharedInputs: true
    });
  }
  
  collection = collection.map(function(image) {
    image = image.reproject(options.srs, null, options.pixelScale)
                 .clipToCollection(zones);
    var ndwi      = options.ndwiMask ? process.ndwi(image).gt(0) : false, 
        cloudMask = options.cloudMask ? process.cloudMask(image) : false, 
        mask      = ndwi ? (cloudMask ? ndwi.and(cloudMask) : ndwi) : cloudMask, 
        slh       = false, 
        chl       = false, 
        pcd       = false;
    for(var key in products) {
      if(!products[key].process) continue;
      var pname = products[key].name, 
          processed;
      if(pname === "PCD") {
        //if(!slh || !chl) continue;
        processed = products[key].process(slh, chl, options.pcdOptions);
        if(mask) processed = processed.mask(mask);
        pcd = processed;
      } else if(pname === "SLH_MASK_PCD") {
        //if(!pcd) continue;
        processed = slh.mask(pcd.lt(1));
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
      image = image.addBands(processed.rename(pname));
    }
    return image;
  });
  
  var minPixelCount = options.minPixelCount || 0;
  if(!minPixelCount && options.minPixelHa) {
    minPixelCount = Math.ceil(10000*options.minPixelHa/Math.pow(options.pixelScale, 2));
  }
  var filterMinPc = ee.Filter.gte('count',  minPixelCount);
  
  var results = {};
  for(var key in products) {
    if(!products[key].process || !products[key].stats) continue;
    results[key] = collection.select(products[key].name)
      .map(function(image) {
        return image.reduceRegions({
            collection: zones, 
            reducer: reducer, 
            scale: options.pixelScale
          });
      })
      .flatten()
      .map(function(feature) {
        var id    = ee.String(feature.id()), 
            date  = id.slice(0, 8), 
            year  = ee.Number.parse(date.slice(0,4)), 
            month = ee.Number.parse(date.slice(4,6)), 
            day   = ee.Number.parse(date.slice(6));
        return feature.set('date', ee.Date.fromYMD(year, month, day));
      })
      .filter(filterMinPc)
  }
  if(!Object.keys(results).length) return;
  
  return {
    // pick any result pixel count (prefer SLH but go down priorities, note most products filter for >0)
    count:   results.slh_pcd || results.slh || results.chl || results.tsm || results.fnu, 
    SLH_PCD: results.slh_pcd || false, 
    SLH:     results.slh, 
    CHL2:    results.chl, 
    TSM:     results.tsm, 
    FNU:     results.fnu
  };
};

exports.chartBasic = function(results, stats) {
  if(~stats.indexOf("all")) stats = ["mean", "median", "p90"];
  
  if(results.SLH_PCD) {
    var chartSlhPcd = ui.Chart.feature.byFeature(results.SLH_PCD, 'date', stats)
      .setChartType('ScatterChart')
      .setOptions({
        title: 'SLH values (w/ PCD mask)',
        hAxis: {title: 'Date'},
        vAxis: {title: 'SLH (x10,000)'}, 
        lineWidth: 1, 
        pointSize: 3
      });
    print(chartSlhPcd);
  }
  
  if(results.SLH) {
    var chartSlh = ui.Chart.feature.byFeature(results.SLH, 'date', stats)
      .setChartType('ScatterChart')
      .setOptions({
        title: 'SLH values',
        hAxis: {title: 'Date'},
        vAxis: {title: 'SLH (x10,000)'}, 
        lineWidth: 1, 
        pointSize: 3
      });
    print(chartSlh);
  }

  if(results.CHL2) {
    var chartChl = ui.Chart.feature.byFeature(results.CHL2, 'date', stats)
      .setChartType('ScatterChart')
      .setOptions({
        title: 'Chl-a (2-band algorithm)',
        hAxis: {title: 'Date'},
        vAxis: {title: 'mg/m^3'}, 
        lineWidth: 1, 
        pointSize: 3
      });
    print(chartChl);
  }
    
  if(results.TSM) {
    var chartTsm = ui.Chart.feature.byFeature(results.TSM, 'date', stats)
      .setChartType('ScatterChart')
      .setOptions({
        title: 'Turbidity TSM',
        hAxis: {title: 'Date'},
        vAxis: {title: 'g/m^3'}, 
        lineWidth: 1, 
        pointSize: 3
      });
    print(chartTsm);
  }

  if(results.FNU) {
    var chartFNU = ui.Chart.feature.byFeature(results.FNU, 'date', stats)
      .setChartType('ScatterChart')
      .setOptions({
        title: 'Turbidity FNU',
        hAxis: {title: 'Date'},
        vAxis: {title: 'FNU'}, 
        lineWidth: 1, 
        pointSize: 3
      });
    print(chartFNU);
  }
  
  var chartPc = ui.Chart.feature.byFeature(results.count, 'date', 'count')
    .setChartType('ScatterChart')
    .setOptions({
      title: 'Valid pixel count',
      hAxis: {title: 'Date'},
      vAxis: {title: 'Pixel count'}, 
      lineWidth: 1, 
      pointSize: 3
    });
  print(chartPc);
};

exports.chartGrouped = function(results, stats, nameField) {
  if(~stats.indexOf("all")) stats = ["mean", "median", "p90"];
  
  stats.forEach(function(stat) {
    var statStr = stat;
    switch(stat) {
      case "p90":
        statStr = "90th percentile"
        break;
      default:
        statStr = stat.charAt(0).toUpperCase() + stat.slice(1);
        break;
    }
    
    if(results.SLH_PCD) {
      var chartSlhPcd = ui.Chart.feature.groups(results.SLH_PCD, 'date', stat, nameField)
        .setChartType('ScatterChart')
        .setOptions({
          title: statStr+' SLH values (w/ PCD mask)',
          hAxis: {title: 'Date'},
          vAxis: {title: 'SLH (x10,000)'}, 
          lineWidth: 1, 
          pointSize: 3
        });
      print(chartSlhPcd);
    }
    
    if(results.SLH) {
      var chartSlh = ui.Chart.feature.groups(results.SLH, 'date', stat, nameField)
        .setChartType('ScatterChart')
        .setOptions({
          title: statStr+' SLH values',
          hAxis: {title: 'Date'},
          vAxis: {title: 'SLH (x10,000)'}, 
          lineWidth: 1, 
          pointSize: 3
        });
      print(chartSlh);
    }
  
    if(results.CHL2) {
      var chartChl = ui.Chart.feature.groups(results.CHL2, 'date', stats, nameField)
        .setChartType('ScatterChart')
        .setOptions({
          title: statStr+' Chl-a (2-band algorithm)',
          hAxis: {title: 'Date'},
          vAxis: {title: 'mg/m^3'}, 
          lineWidth: 1, 
          pointSize: 3
        });
      print(chartChl);
    }
    
    if(results.TSM) {
      var chartTsm = ui.Chart.feature.groups(results.TSM, 'date', stat, nameField)
        .setChartType('ScatterChart')
        .setOptions({
          title: statStr+' Turbidity TSM',
          hAxis: {title: 'Date'},
          vAxis: {title: 'TSM (g/m^3)'}, 
          lineWidth: 1, 
          pointSize: 3
        });
      print(chartTsm);
    }

    if(results.FNU) {
      var chartFnu = ui.Chart.feature.groups(results.FNU, 'date', stats, nameField)
        .setChartType('ScatterChart')
        .setOptions({
          title: statStr+' Turbidity FNU',
          hAxis: {title: 'Date'},
          vAxis: {title: 'FNU'}, 
          lineWidth: 1, 
          pointSize: 3
        });
      print(chartFnu);
    }
  });
  
  var chartPc = ui.Chart.feature.groups(results.count, 'date', 'count', nameField)
    .setChartType('ScatterChart')
    .setOptions({
      title: 'ROI valid pixel count',
      hAxis: {title: 'Date'},
      vAxis: {title: 'Pixel count'}, 
      lineWidth: 1, 
      pointSize: 3
    });
  print(chartPc);
};

exports.chartIndividual = function(results, stats, zones, nameField) {
  if(~stats.indexOf("all")) stats = ["mean", "median", "p90"];
  
  // need to put out graph per subarea
  var count = zones.size().getInfo(), 
      featList = zones.toList(count);
  for(var i = 0; i < count; ++i) {
    var subarea = ee.Feature(featList.get(i)), 
        name = ee.String(subarea.get(nameField));
    
    if(results.SLH_PCD) {
      var resultsSubSlhPcd = results.SLH_PCD.filter(ee.Filter.eq(nameField, name)), 
          chartSlhPcd = ui.Chart.feature.byFeature(resultsSubSlhPcd, 'date', stats)
            .setChartType('ScatterChart')
            .setOptions({
              title: name.cat(' SLH values (w/ PCD mask)').getInfo(),
              hAxis: {title: 'Date'},
              vAxis: {title: 'SLH (x10,000)'}, 
              lineWidth: 1, 
              pointSize: 3
            });
      print(chartSlhPcd);
    }
    
    if(results.SLH) {
      var resultsSubSlh = results.SLH.filter(ee.Filter.eq(nameField, name)), 
          chartSlh = ui.Chart.feature.byFeature(resultsSubSlh, 'date', stats)
            .setChartType('ScatterChart')
            .setOptions({
              title: name.cat(' SLH values').getInfo(),
              hAxis: {title: 'Date'},
              vAxis: {title: 'SLH (x10,000)'}, 
              lineWidth: 1, 
              pointSize: 3
            });
      print(chartSlh);
    }
  
    if(results.CHL2) {
      var resultsSubChl = results.CHL2.filter(ee.Filter.eq(nameField, name)), 
          chartChl = ui.Chart.feature.byFeature(resultsSubChl, 'date', stats)
          .setChartType('ScatterChart')
          .setOptions({
            title: name.cat(' Chl-a (2-band algorithm)').getInfo(),
            hAxis: {title: 'Date'},
            vAxis: {title: 'mg/m^3'}, 
            lineWidth: 1, 
            pointSize: 3
          });
      print(chartChl);
    }
    
    if(results.TSM) {
      var resultsSubTsm = results.TSM.filter(ee.Filter.eq(nameField, name)), 
          chartTsm = ui.Chart.feature.byFeature(resultsSubTsm, 'date', stats)
            .setChartType('ScatterChart')
            .setOptions({
              title: name.cat(' Turbidity TSM').getInfo(),
              hAxis: {title: 'Date'},
              vAxis: {title: 'TSM (g/m^3)'}, 
              lineWidth: 1, 
              pointSize: 3
            });
      print(chartTsm);
    }
    
    if(results.FNU) {
      var resultsSubFnu = results.FNU.filter(ee.Filter.eq(nameField, name)), 
          chartTurbidity = ui.Chart.feature.byFeature(resultsSubTurb, 'date', stats)
          .setChartType('ScatterChart')
          .setOptions({
            title: name.cat(' Turbidity FNU').getInfo(),
            hAxis: {title: 'Date'},
            vAxis: {title: 'FNU'}, 
            lineWidth: 1, 
            pointSize: 3
          });
      print(resultsSubFnu);
    }
  }
    
  var chartPc = ui.Chart.feature.groups(results.count, 'date', 'count', nameField)
    .setChartType('ScatterChart')
    .setOptions({
      title: 'ROI valid pixel count',
      hAxis: {title: 'Date'},
      vAxis: {title: 'Pixel count'}, 
      lineWidth: 1, 
      pointSize: 3
    });
  print(chartPc);
};

exports.chartPcdFilter = function(results, options) {
  options = options || {};
  var nameField  = options.nameField, 
      threshold  = options.threshold  || 15.0, 
      slope      = options.slope      || 0.43, 
      yIntercept = options.yIntercept || 6.9, 
      poly       = false;
  if(options.usePolynomial) {
    if(options.poly && options.poly.length >= 3) {
      poly = options.poly;
    } else {
      poly = [-0.0004, 0.45, 6.9];
    }
  }
  
  var joinOn = ee.Filter.equals({leftField: 'date', rightField: 'date'});
  if(nameField) {
    joinOn = ee.Filter.and(
      joinOn, 
      ee.Filter.equals({leftField: nameField, rightField: nameField})
    );
  }
  
  var model = ee.Join.inner("slh", "chl").apply( 
        results.SLH, 
        results.CHL2, 
        ee.Filter.equals({leftField: 'date', rightField: 'date'})
      )
      .map(function(entry) {
        var ft1  = ee.Feature(entry.get("slh")), 
            slh  = ee.Number(ft1.get("mean")), 
            chl  = ee.Number(ee.Feature(entry.get("chl")).get("mean")), 
            chlp;
        if(poly) {
          chlp = ee.Number(poly[2])
            .add(slh.multiply(poly[1]))
            .add(slh.pow(2).multiply(poly[0]));
        } else {
          chlp = slh.multiply(slope).add(yIntercept);
        }
        return ee.Feature(null, {
          name: nameField ? ee.String(ft1.get(nameField)) : "", 
          date: ee.Date(ft1.get("date")), 
          slh:  slh, 
          chl:  chl, 
          err:  chlp.subtract(chl)
        });
      }), 
      filtered = model.filter(ee.Filter.lt("err", threshold));
  
  var chartSlhFiltered, chartSlh, chartChl;
  if(!nameField) {
    chartSlhFiltered = ui.Chart.feature.byFeature(filtered, 'date', 'slh')
      .setChartType('ScatterChart')
      .setOptions({
        title: 'SLH (filtered)',
        hAxis: {title: 'Date'},
        vAxis: {title: 'SLH (x10,000)'}, 
        lineWidth: 1, 
        pointSize: 3
      });
    if(options.chartOthers) {
      chartSlh = ui.Chart.feature.byFeature(model, 'date', 'slh')
        .setChartType('ScatterChart')
        .setOptions({
          title: 'SLH (all)',
          hAxis: {title: 'Date'},
          vAxis: {title: 'SLH (x10,000)'}, 
          lineWidth: 1, 
          pointSize: 3
        });
      chartChl = ui.Chart.feature.byFeature(model, 'date', 'chl')
        .setChartType('ScatterChart')
        .setOptions({
          title: 'Chl-a (2-band algorithm)',
          hAxis: {title: 'Date'},
          vAxis: {title: 'mg/m^3'}, 
          lineWidth: 1, 
          pointSize: 3
        });
    }
  } else {
    chartSlhFiltered = ui.Chart.feature.groups(filtered, 'date', 'slh', nameField)
      .setChartType('ScatterChart')
      .setOptions({
        title: 'SLH (filtered)',
        hAxis: {title: 'Date'},
        vAxis: {title: 'SLH (x10,000)'}, 
        lineWidth: 1, 
        pointSize: 3
      });
    if(options.chartOthers) {
      chartSlh = ui.Chart.feature.groups(model, 'date', 'slh', nameField)
        .setChartType('ScatterChart')
        .setOptions({
          title: 'SLH (all)',
          hAxis: {title: 'Date'},
          vAxis: {title: 'SLH (x10,000)'}, 
          lineWidth: 1, 
          pointSize: 3
        });
      chartChl = ui.Chart.feature.groups(model, 'date', 'chl', nameField)
        .setChartType('ScatterChart')
        .setOptions({
          title: 'Chl-a (2-band algorithm)',
          hAxis: {title: 'Date'},
          vAxis: {title: 'mg/m^3'}, 
          lineWidth: 1, 
          pointSize: 3
        });
    }
  }
  print(chartSlhFiltered);
  if(chartSlh) print(chartSlh);
  if(chartChl) print(chartChl);
};
