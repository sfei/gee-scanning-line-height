var roi = /* GEE Polygon reference on map */, 
    view = /* GEE Polygon reference on map */;


var singledate = require("{{repo}}:lib/singledate.js");

var options = {
      layers:           ["SLH", "Chl"], //"FNU"], 
      ndwiMask:         true, 
      chlMax:           150, 
      useTOA:           false, 
      subareas:         ee.FeatureCollection(ee.Feature(roi, {NAME: "ROI"})),
      subareaNameField: "NAME"
    }, 
    usedate = "2022-04-25", 
    exportImages = false;

var images = singledate.analyze(roi, usedate, options);

Map.centerObject(view);

if(exportImages) {
  for(var key in images) {
    if(!images[key]) continue;
    var filename = usedate + "_" + key;
    Export.image.toDrive({
      image: images[key],
      description: filename,
      scale: 40, // this is the pixel size, adjust as needed
      region: view
    });
  }
}