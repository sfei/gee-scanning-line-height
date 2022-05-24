exports.ndwi = function(image) {
  return image.expression(
      "(B3 - B8) / (B3 + B8)", 
      {
        B3: image.select("B3"), 
        B8: image.select("B8")
      }
    ).rename("NDWI");
};

exports.cloudMask = function(image) {
  var qa60 = image.select("QA60");
  return qa60.bitwiseAnd(1 << 10).eq(0).and(qa60.bitwiseAnd(1 << 11).eq(0))
             .rename("CLOUDMASK");
};

exports.slh = function(image, unquantize) {
  // Scanning Line Height -- Kudela et al. 2015
  // NOTE: by default, not un-quantized
  var res = image.expression(
      "B5 - B4 - (B6 - B4)*0.52", 
      {
        B4: image.select("B4"), 
        B5: image.select("B5"), 
        B6: image.select("B6")
      }
    ).rename("SLH");
  if(unquantize) res = res.multiply(0.0001);
  return res.mask(res.gte(0));
};

exports.tsm665 = function(image) {
  // Single-band total suspended material algorithm -- Nechad et al. 2009
  // g/m^3
  var res = image.expression(
      "355.85 * B4/(1.0 - B4/0.1728)", 
      {B4: image.select("B4").multiply(0.0001)}
    ).rename("TSM");
  return res.mask(res.gte(0));
};

exports.fnu = function(image) {
  // Single-band turbidity algorithm -- Nechad et al. 2009
  // FNU
  var res = image.expression(
      "282.95 * B4/(1.0 - B4/0.1728) + 0.23", 
      {B4: image.select("B4").multiply(0.0001)}
    )
    .rename("FNU");
  return res.mask(res.gte(0));
};

exports.chl2 = function(image) {
  // two-band Chl-a algorithm -- Moses et al. 2012
  // mg/m^3 -- accuracy drops below 5 mg/m^3
  var res = image.expression(
      "61.324 * B5/B4 - 37.94", 
      //"(35.75 * B5/B4 - 19.3)^1.124", 
      {
        B4: image.select("B4").multiply(0.0001), 
        B5: image.select("B5").multiply(0.0001)
      }
    ).rename("CHL2");
  return res.mask(res.gte(0));
};

exports.chl3 = function(image) {
  // three-band Chl-a algorithm -- Moses et al. 2012
  // mg/m^3 -- accuracy drops below 5 mg/m^3
  var res = image.expression(
      "232.29 * B6 / (B4 - B5) + 23.174", 
      //"(113.36 * B6 / (B4 - B5) + 16.45)^1.124", 
      {
        B4: image.select("B4").multiply(0.0001), 
        B5: image.select("B5").multiply(0.0001), 
        B6: image.select("B6").multiply(0.0001)
      }
    ).rename("CHL3");
  return res.mask(res.gte(0));
};

exports.pcd = function(slh, chl, options) {
  var pchl;
  if(options.usePolynomial) {
    var poly = options.poly && options.poly.length >= 3 
               ? options.poly 
               : [-0.0004, 0.45, 6.9];
    pchl = slh.pow(2).multiply(poly[0])
              .add(slh.multiply(poly[1]))
              .add(poly[2]);
  } else {
    var slope      = options.slope      || 0.43, 
        yIntercept = options.yIntercept || 6.9;
    pchl = slh.multiply(slope)
              .add(yIntercept);
  }
  return pchl.subtract(chl).rename("PCD").divide(options.threshold || 15);
};
