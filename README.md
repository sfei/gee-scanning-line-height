----------

# GEE Scanning Line Height Scripts #

----------

**Lawrence Sim** -- lawrences@sfei.org  
**San Francisco Estuary Institute** -- 2022

## License ##

This project is licensed under the GNU Lesser General Public License. See [LICENSE](LICENSE) for full details.

## Install ##

The project code is provided as is here for ease of distribution. A working version of this repo may also be found in GEE under `users/lawrences/slh`, though organization and exact code structure may be different.

To install from this repo, copy all javascript files into your GEE project. Find and replace all instances of `{{repo}}` in the code with the path to the GEE repo name.

## Usage ##

The scripts under the main directory (`region-singledate.js` and `region-timeseris.js`) provided entry points for single-date processing and timeseries processing.

At the top of each script are variables for `roi` and/or `view`. These must be replaced with GEE map objects (either `Polygon` or `FeatureCollection`) once imported into GEE. By moving around these features on the map, the location of the script run can be easily adjusted by moving/adjusting these features.
