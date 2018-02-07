import util from '../util/util';
import palettes from '../palettes/palettes';
import OlTileGridWMTS from 'ol/tilegrid/wmts';
import OlSourceWMTS from 'ol/source/wmts';
import OlSourceTileWMS from 'ol/source/tilewms';
import OlLayerGroup from 'ol/layer/group';
import OlLayerTile from 'ol/layer/tile';
import OlTileGridTileGrid from 'ol/tilegrid/tilegrid';
import Style from 'ol/style/style';
import Circle from 'ol/style/circle';
import Icon from 'ol/style/icon';
import Fill from 'ol/style/fill';
import MVT from 'ol/format/mvt';
import Stroke from 'ol/style/stroke';
import LayerVectorTile from 'ol/layer/vectortile';
import SourceVectorTile from 'ol/source/vectortile';
import lodashCloneDeep from 'lodash/cloneDeep';
import lodashMerge from 'lodash/merge';
import lodashEach from 'lodash/each';
import { lookupFactory } from '../ol/lookupimagetile';

export function mapLayerBuilder(models, config, cache, Parent) {
  var self = {};
  self.init = function (Parent) {
    self.extentLayers = [];
    Parent.events.on('selecting', hideWrap);
    Parent.events.on('selectiondone', showWrap);
  };
  /*
   * Create a new OpenLayers Layer
   *
   * @method createLayer
   * @static
   *
   * @param {object} def - Layer Specs
   *
   * @param {object} options - Layer options
   *
   *
   * @returns {object} OpenLayers layer
   */
  self.createLayer = function (def, options) {
    var color, hexColor, date, key, proj, layer, layerNext, layerPrior, attributes;
    options = options || {};
    key = self.layerKey(def, options);
    proj = models.proj.selected;
    layer = cache.getItem(key);
    if (!layer) {
      date = options.date || models.date.selected;
      attributes = {
        id: def.id,
        key: key,
        date: util.toISOStringDate(date),
        proj: proj.id,
        def: def
      };
      def = lodashCloneDeep(def);
      lodashMerge(def, def.projections[proj.id]);
      if (def.type === 'wmts') {
        layer = createLayerWMTS(def, options);
        if (proj.id === 'geographic' && def.wrapadjacentdays === true) {
          layerNext = createLayerWMTS(def, options, 1);
          layerPrior = createLayerWMTS(def, options, -1);

          layer.wv = attributes;
          layerPrior.wv = attributes;
          layerNext.wv = attributes;

          layer = new OlLayerGroup({
            layers: [layer, layerNext, layerPrior]
          });
        }
      } else if (def.type === 'vector') {
        // Add vector layer style to config.rendered object
        var promises = [];
        if (config.layers[def.id] && config.layers[def.id].vectorStyle) {
          promises.push(palettes.loadRenderedVectorStyle(config, def.id));
        }

        layer = createLayerVector(def, options, null);
        if (proj.id === 'geographic' && def.wrapadjacentdays === true) {
          layerNext = createLayerVector(def, options, 1);
          layerPrior = createLayerVector(def, options, -1);

          layer.wv = attributes;
          layerPrior.wv = attributes;
          layerNext.wv = attributes;

          layer = new OlLayerGroup({
            layers: [layer, layerNext, layerPrior]
          });
        }
      } else if (def.type === 'wms') {
        layer = createLayerWMS(def, options);
        if (proj.id === 'geographic' && def.wrapadjacentdays === true) {
          layerNext = createLayerWMS(def, options, 1);
          layerPrior = createLayerWMS(def, options, -1);

          layer.wv = attributes;
          layerPrior.wv = attributes;
          layerNext.wv = attributes;

          layer = new OlLayerGroup({
            layers: [layer, layerNext, layerPrior]
          });
        }
      } else {
        throw new Error('Unknown layer type: ' + def.type);
      }
      layer.wv = attributes;
      cache.setItem(key, layer);
      layer.setVisible(false);
    }
    layer.setOpacity(def.opacity || 1.0);
    return layer;
  };
  /*
   * Create a layer key
   *
   * @function layerKey
   * @static
   *
   * @param {Object} def - Layer properties
   *
   * @param {number} options - Layer options
   *
   * @returns {object} layer key Object
   */
  self.layerKey = function (def, options) {
    var layerId = def.id;
    var projId = models.proj.selected.id;
    var date;
    if (options.date) {
      date = util.toISOStringDate(options.date);
    } else {
      date = util.toISOStringDate(models.date.selected);
    }
    var dateId = (def.period === 'daily') ? date : '';
    var palette = '';
    if (models.palettes.isActive(def.id)) {
      palette = models.palettes.key(def.id);
    }
    return [layerId, projId, dateId, palette].join(':');
  };
  /*
   * Create a new WMTS Layer
   *
   * @method createLayerWMTS
   * @static
   *
   * @param {object} def - Layer Specs
   *
   * @param {object} options - Layer options
   *
   *
   * @returns {object} OpenLayers WMTS layer
   */
  var createLayerWMTS = function (def, options, day) {
    var proj, source, matrixSet, matrixIds, urlParameters,
      date, extent, start;
    proj = models.proj.selected;
    source = config.sources[def.source];
    extent = proj.maxExtent;
    start = [proj.maxExtent[0], proj.maxExtent[3]];
    if (!source) {
      throw new Error(def.id + ': Invalid source: ' + def.source);
    }
    matrixSet = source.matrixSets[def.matrixSet];
    if (!matrixSet) {
      throw new Error(def.id + ': Undefined matrix set: ' + def.matrixSet);
    }
    if (typeof def.matrixIds === 'undefined') {
      matrixIds = [];
      lodashEach(matrixSet.resolutions, function (resolution, index) {
        matrixIds.push(index);
      });
    } else {
      matrixIds = def.matrixIds;
    }

    if (day) {
      if (day === 1) {
        extent = [-250, -90, -180, 90];
        start = [-540, 90];
      } else {
        extent = [180, -90, 250, 90];
        start = [180, 90];
      }
    }

    urlParameters = '?';
    if (def.period === 'daily') {
      date = options.date || models.date.selected;
      if (day) {
        date = util.dateAdd(date, 'day', day);
      }
      urlParameters = '&TIME=' + util.toISOStringDate(date);
    }
    var sourceOptions = {
      url: source.url + urlParameters,
      layer: def.layer || def.id,
      crossOrigin: 'anonymous',
      format: def.format,
      transition: 0,
      matrixSet: matrixSet.id,
      tileGrid: new OlTileGridWMTS({
        origin: start,
        resolutions: matrixSet.resolutions,
        matrixIds: matrixIds,
        tileSize: matrixSet.tileSize[0]
      }),
      wrapX: false,
      style: typeof def.style === 'undefined' ? 'default' : def.style
    };
    if (models.palettes.isActive(def.id)) {
      var lookup = models.palettes.getLookup(def.id);
      sourceOptions.tileClass = lookupFactory(lookup, sourceOptions);
    }
    var layer = new OlLayerTile({
      extent: extent,
      source: new OlSourceWMTS(sourceOptions)
    });

    return layer;
  };

  /*
   * Create a new Vector Layer
   *
   * @method createLayerVector
   * @static
   *
   * @param {object} def - Layer Specs
   *
   * @param {object} options - Layer options
   *
   *
   * @returns {object} OpenLayers Vector layer
   */
  var createLayerVector = function(def, options, day) {
    var date, urlParameters, proj, extent, source, matrixSet, matrixIds, start, renderColor;
    var styleCache = {};
    proj = models.proj.selected;
    source = config.sources[def.source];
    extent = proj.maxExtent;
    start = [proj.maxExtent[0], proj.maxExtent[3]];

    if (!source) { throw new Error(def.id + ': Invalid source: ' + def.source); }
    if (!source) {
      throw new Error(def.id + ': Invalid source: ' + def.source);
    }
    matrixSet = source.matrixSets[def.matrixSet];
    if (!matrixSet) {
      throw new Error(def.id + ': Undefined matrix set: ' + def.matrixSet);
    }
    if (typeof def.matrixIds === 'undefined') {
      matrixIds = [];
      lodashEach(matrixSet.resolutions, function(resolution, index) {
        matrixIds.push(index);
      });
    } else {
      matrixIds = def.matrixIds;
    }

    if (day) {
      if (day === 1) {
        extent = [-250, -90, -180, 90];
        start = [-540, 90];
      } else {
        extent = [180, -90, 250, 90];
        start = [180, 90];
      }
    }

    var layerName = def.layer || def.id;
    var tms = def.matrixSet;

    urlParameters = '?' +
    '&layer=' + layerName +
    '&tilematrixset=' + tms +
    '&Service=WMTS' +
    '&Request=GetTile' +
    '&Version=1.0.0' +
    '&FORMAT=application%2Fvnd.mapbox-vector-tile' +
    '&TileMatrix={z}&TileCol={x}&TileRow={y}';

    if (def.period === 'daily') {
      date = options.date || models.date.selected;
      if (day) {
        date = util.dateAdd(date, 'day', day);
      }
      urlParameters += '&TIME=' + util.toISOStringDate(date);
    }

    var sourceOptions = new SourceVectorTile({
      url: source.url + urlParameters,
      layer: layerName,
      crossOrigin: 'anonymous',
      format: new MVT(),
      matrixSet: tms,
      tileGrid: new OlTileGridTileGrid({
        extent: extent,
        origin: start,
        resolutions: matrixSet.resolutions,
        tileSize: matrixSet.tileSize
      })
    });

    var styleOptions = function(feature, resolution) {

      // Get the rendered vectorStyle's object containing groups of styles based on features
      var layerStyles = config.vectorStyles.rendered[def.id].styles;
      // Each group in the object will have a property and name to be matched to vector point features
      var styleGroup = Object.keys(layerStyles).map(e => layerStyles[e]);

      lodashEach(styleGroup, function(styleValues, styleKeys) {
        var stylePropertyKey = styleValues.property;
        // Style features with matching style properties
        if (feature.properties_[stylePropertyKey]) {
          // Style fire layer confidence
          if (feature.type_ === 'Point' && stylePropertyKey === 'CONFIDENCE') {

          }
          // Ensure the feature is a point and the style has a property of time to style big/little time points
          else if (feature.type_ === 'Point' && stylePropertyKey === 'time') {
            // console.log(styleValues);
            // Use regular expression here to style little vs big points
            //
            // Little Points = ^[0-9][0-9]:[0-9][1,2,3,4,6,7,8,9]$
            // Big Points = ^[0-9][0-9]:[0-9][0,5]$
            var pattern = new RegExp(feature.properties_.regex);
            var time = feature.properties_.time;
            var test = pattern.test(time);
            if (test) {

            }
          }
        // Must specify LineString and lines since these values are different
        // TODO: Make these values match in the style json.
        } else if (feature.type_ === 'LineString' && styleValues['lines']) {
        } else {
          // return [defaultStyle];
        }
      });

      var fill = new Fill({
        color: 'rgba(255,0,0,0.4)'
      });
      var stroke = new Stroke({
        color: '#3399CC',
        width: 1.25
      });

      // Create styleCache Object
      // ref: http://openlayers.org/en/v3.10.1/examples/kml-earthquakes.html
      // ref: http://openlayersbook.github.io/ch06-styling-vector-layers/example-07.html

      // get the CONFIDENCE from the feature properties
      var confidence = feature.get('CONFIDENCE');
      // console.log(testing);
      // if there is no testing or its one we don't recognize,
      // return the default style (in an array!)
      var confidenceStyle = styleCache[confidence];
      // check the cache and create a new style for the income
      // testing if its not been created before.
      if (!confidenceStyle) {
        // console.log(testing);
        confidenceStyle = new Style({
          fill: new Fill({
            color: [250, 0, 0, 1]
          }),
          stroke: new Stroke({
            color: [250, 0, 0, 1],
            width: 1
          }),
          image: new Circle({
            fill: fill,
            stroke: stroke,
            radius: 5
          })
        });
        styleCache[confidence] = confidenceStyle;
      }
      // at this point, the style for the current testing is in the cache
      // so return it (as an array!)
      return confidenceStyle;
    };

    var layer = new LayerVectorTile({
      renderMode: 'image',
      preload: 1,
      extent: extent,
      source: sourceOptions,
      style: styleOptions
    });

    /**
     * Style the vector based on feature tags outline in style json
     * @type {Boolean}
     */
    var setColorFromAttribute = false;
    if (setColorFromAttribute) {
      layer.setStyle(function(feature, resolution) {
        renderColor = color;
        return [
          new Style({
            image: new Circle({
              radius: 5,
              fill: new Fill({ color: renderColor })
            })
          })
        ];
      });

      // var newColor = util.rgbaToShortHex(color);
      // layer.setStyle(function(feature, resolution) {
      //   var confidence = feature.get('CONFIDENCE');
      //   var dir = feature.get('dir');
      //   if (confidence) {
      //     renderColor = util.changeHue(newColor, confidence);
      //     return [
      //       new Style({
      //         image: new Circle({
      //           radius: 5,
      //           fill: new Fill({ color: renderColor })
      //         })
      //       })
      //     ];
      //   } else if (dir) {
      //     var radian = dir * Math.PI / 180;
      //     return [
      //       new Style({
      //         image: new Icon({
      //           src: 'images/direction_arrow.png',
      //           imgSize: [12, 12],
      //           rotation: radian
      //         })
      //       })
      //     ];
      //   } else {
      //     renderColor = color;
      //     return [
      //       new Style({
      //         image: new Circle({
      //           radius: 5,
      //           fill: new Fill({ color: renderColor })
      //         })
      //       })
      //     ];
      //   }
      // });
    }

    return layer;
  };

  /*
   * Create a new WMS Layer
   *
   * @method createLayerWMTS
   * @static
   *
   * @param {object} def - Layer Specs
   *
   * @param {object} options - Layer options
   *
   *
   * @returns {object} OpenLayers WMS layer
   */
  var createLayerWMS = function (def, options, day) {
    var proj, source, urlParameters, transparent,
      date, extent, start, res, parameters;
    proj = models.proj.selected;
    source = config.sources[def.source];
    extent = proj.maxExtent;
    start = [proj.maxExtent[0], proj.maxExtent[3]];
    res = proj.resolutions;
    if (!source) { throw new Error(def.id + ': Invalid source: ' + def.source); }

    transparent = (def.format === 'image/png');
    if (proj.id === 'geographic') {
      res = [0.28125, 0.140625, 0.0703125, 0.03515625, 0.017578125, 0.0087890625, 0.00439453125,
        0.002197265625, 0.0010986328125, 0.00054931640625, 0.00027465820313];
    }
    if (day) {
      if (day === 1) {
        extent = [-250, -90, -180, 90];
        start = [-540, 90];
      } else {
        extent = [180, -90, 250, 90];
        start = [180, 90];
      }
    }
    parameters = {
      LAYERS: def.layer || def.id,
      FORMAT: def.format,
      TRANSPARENT: transparent,
      VERSION: '1.1.1'
    };
    if (def.styles) { parameters.STYLES = def.styles; }

    urlParameters = '?';

    if (def.period === 'daily') {
      date = options.date || models.date.selected;
      if (day) {
        date = util.dateAdd(date, 'day', day);
      }
      urlParameters += 'TIME=' + util.toISOStringDate(date);
    }
    var sourceOptions = {
      url: source.url + urlParameters,
      wrapX: true,
      style: 'default',
      crossOrigin: 'anonymous',
      params: parameters,
      transition: 0,
      tileGrid: new OlTileGridTileGrid({
        origin: start,
        resolutions: res
      })
    };

    if (models.palettes.isActive(def.id)) {
      var lookup = models.palettes.getLookup(def.id);
      sourceOptions.tileClass = lookupFactory(lookup, sourceOptions);
    }
    var layer = new OlLayerTile({
      extent: extent,
      source: new OlSourceTileWMS(sourceOptions)
    });
    return layer;
  };
  var hideWrap = function () {
    var layer;
    var key;
    var layers;

    layers = models.layers.active;

    for (var i = 0, len = layers.length; i < len; i++) {
      layer = layers[i];
      if (layer.wrapadjacentdays && layer.visible) {
        key = self.layerKey(layer, {
          date: models.date.selected
        });
        layer = cache.getItem(key);
        layer.setExtent([-180, -90, 180, 90]);
      }
    }
  };
  var showWrap = function () {
    var layer;
    var layers;
    var key;

    layers = models.layers.active;
    for (var i = 0, len = layers.length; i < len; i++) {
      layer = layers[i];
      if (layer.wrapadjacentdays && layer.visible) {
        key = self.layerKey(layer, {
          date: models.date.selected
        });
        layer = cache.getItem(key);
        layer.setExtent([-250, -90, 250, 90]);
      }
    }
  };
  self.init(Parent);
  return self;
};