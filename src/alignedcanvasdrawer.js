/*
 * OpenSeadragon - AlignedCanvasDrawer
 *
 * Copyright (C) 2009 CodePlex Foundation
 * Copyright (C) 2010-2024 OpenSeadragon contributors
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 * - Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * - Redistributions in binary form must reproduce the above copyright
 *   notice, this list of conditions and the following disclaimer in the
 *   documentation and/or other materials provided with the distribution.
 *
 * - Neither the name of CodePlex Foundation nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

(function ($) {

const OpenSeadragon = $; // (re)alias back to OpenSeadragon for JSDoc

/**
 * @class OpenSeadragon.AlignedCanvasDrawer
 * @extends OpenSeadragon.DrawerBase
 * @classdesc Default implementation of AlignedCanvasDrawer for an {@link OpenSeadragon.Viewer}.
 * @param {Object} options - Options for this Drawer.
 * @param {OpenSeadragon.Viewer} options.viewer - The Viewer that owns this Drawer.
 * @param {OpenSeadragon.Viewport} options.viewport - Reference to Viewer viewport.
 * @param {Element} options.element - Parent element.
 * @param {Number} [options.debugGridColor] - See debugGridColor in {@link OpenSeadragon.Options} for details.
 */

class AlignedCanvasDrawer extends OpenSeadragon.DrawerBase {
    constructor(options) {
        super(options);
        /**
         * The HTML element (canvas) that this drawer uses for drawing
         * @member {Element} canvas
         * @memberof OpenSeadragon.AlignedCanvasDrawer#
         */

        /**
         * The parent element of this Drawer instance, passed in when the Drawer was created.
         * The parent of {@link OpenSeadragon.WebGLDrawer#canvas}.
         * @member {Element} container
         * @memberof OpenSeadragon.AlignedCanvasDrawer#
         */

        /**
         * 2d drawing context for {@link OpenSeadragon.AlignedCanvasDrawer#canvas}.
         * @member {Object} context
         * @memberof OpenSeadragon.AlignedCanvasDrawer#
         * @private
         */
        this.context = this.canvas.getContext("2d");
        this.scanvas = document.createElement("canvas");
        this.scontext = this.scanvas.getContext("2d");

        // Image smoothing for canvas rendering (only if canvas is used).
        // Canvas default is "true", so this will only be changed if user specifies "false" in the options or via setImageSmoothinEnabled.
        this._imageSmoothingEnabled = true;

        // Since the tile-drawn and tile-drawing events are fired by this drawer, make sure handlers can be added for them
        this.viewer.allowEventHandler("tile-drawn");
        this.viewer.allowEventHandler("tile-drawing");
    }

    /**
     * @returns {Boolean} true if canvas is supported by the browser, otherwise false
     */
    static isSupported() {
        return $.supportsCanvas;
    }

    getType() {
        return "canvas";
    }

    getSupportedDataFormats() {
        return ["image"];
    }

    /**
     * create the HTML element (e.g. canvas, div) that the image will be drawn into
     * @returns {Element} the canvas to draw into
     */
    _createDrawingElement() {
        let canvas = $.makeNeutralElement("canvas");
        let viewportSize = this._calculateCanvasSize();
        canvas.width = viewportSize.x;
        canvas.height = viewportSize.y;
        return canvas;
    }

    /**
     * Draws the TiledImages
     */
    draw(tiledImages) {
        this._prepareNewFrame(); // prepare to draw a new frame
        if (tiledImages.length) {
            // background color. Should be the same placeholderFillStyle for all tiledImages
            this.context.fillStyle =
                tiledImages[0].placeholderFillStyle ||
                $.DEFAULT_SETTINGS.placeholderFillStyle;
            this.context.fillRect(
                0,
                0,
                this.canvas.width,
                this.canvas.height
            );
        }
        const imageTilesList = tiledImages.map((tiledImage) =>
            tiledImage.getTilesToDraw().map((info) => info.tile)
        );

        const allTiles = imageTilesList.flat();
        if (allTiles.length) {
            const tiledImage = tiledImages[0];
            let levelSet = Array.from(
                new Set(allTiles.map((tile) => tile.level))
            );
            levelSet.sort((a, b) => +a - +b);

            // canvas will be drawn at a 1-1 pixel ratio with the highest resolution image
            let highTile = allTiles.reduce((curHighTile, newTile) => {
                const curHighTileRatio = curHighTile.sourceBounds.width / curHighTile.size.x;
                const newHighTileRatio = newTile.sourceBounds.width / newTile.size.x;
                if (curHighTileRatio >= newHighTileRatio) {
                    return curHighTile;
                }
                else{
                    return newTile;
                }
            }, allTiles[0]);

            let highTileRatio = highTile.sourceBounds.width / highTile.size.x;

            const viewPortWidth =
                this.viewport._containerInnerSize.x * $.pixelDensityRatio;
            const viewPortHeight =
                this.viewport._containerInnerSize.y * $.pixelDensityRatio;

            // basically an epsilon in pixels
            // for any border interpolation and such
            let roundingSpace = 8;

            const adjViewPortWidth = highTileRatio * viewPortWidth;
            const adjViewPortHeight = highTileRatio * viewPortHeight;
            if (this.viewport.getRotation(true) % 360 !== 0) {
                // can get much more accurate sizes with trigonometry
                // but we really aren't using the empty space on the canvas
                // so it shouldn't be too costly to upper bound
                const sizeCeil = Math.ceil(
                    Math.sqrt(
                        adjViewPortWidth * adjViewPortWidth +
                            adjViewPortHeight * adjViewPortHeight
                    )
                );
                roundingSpace += Math.max(
                    sizeCeil - adjViewPortWidth,
                    sizeCeil - adjViewPortHeight
                );
            }
            let viewportSizeX =
                highTileRatio * viewPortWidth + roundingSpace;
            let viewportSizeY =
                highTileRatio * viewPortHeight + roundingSpace;
            // this forces tiles to be drawn on integer boundaries while the end image still draws on sub-pixel boundaries
            const offsetX =
                -((highTile.position.x * highTileRatio) % 1) +
                Math.round(roundingSpace / 2);
            const offsetY =
                -((highTile.position.y * highTileRatio) % 1) +
                Math.round(roundingSpace / 2);

            if (
                this.scanvas.width < viewportSizeX ||
                this.scanvas.height < viewportSizeY
            ) {
                // only grow canvas size so that we minimize canvas memory re-allocations (always triggers major GC)
                this.scanvas.style.width = "";
                this.scanvas.style.height = "";
                this.scanvas.width = Math.max(
                    this.scanvas.width,
                    Math.ceil(viewportSizeX)
                );
                this.scanvas.height = Math.max(
                    this.scanvas.height,
                    Math.ceil(viewportSizeY)
                );
            }
            // TODO: consider drawing the base canvas back onto this
            // temporary canvas to imitate cross-tiledimage transparency
            this.scontext.fillStyle = tiledImage.placeholderFillStyle;
            this.scontext.fillRect(
                0,
                0,
                this.scanvas.width,
                this.scanvas.height
            );

            for (const idx in tiledImages) {
                const tiledImage = tiledImages[idx];
                const imageTiles = imageTilesList[idx];
                if (tiledImage.opacity !== 0 && imageTiles.length) {
                    this._drawTiles(
                        tiledImage,
                        imageTiles,
                        offsetX,
                        offsetY,
                        highTileRatio
                    );
                }
            }

            // save context state for rotations/opacity/flip modifications
            // note that operations are applied in reverse order of intutive operations
            this.context.save();

            const degrees = this.viewport.getRotation(true) % 360;
            if (degrees !== 0) {
                const point = this._getCanvasCenter();

                this.context.translate(point.x, point.y);
                this.context.rotate((Math.PI / 180) * degrees);
                this.context.translate(-point.x, -point.y);
            }
            if (this.viewer.viewport.getFlip()) {
                const flipPoint = this._getCanvasCenter();

                this.context.translate(flipPoint.x, 0);
                this.context.scale(-1, 1);
                this.context.translate(-flipPoint.x, 0);
            }

            if (tiledImage.opacity && tiledImage.opacity < 1) {
                this.context.globalAlpha = tiledImage.opacity;
            }

            if ($.pixelDensityRatio !== 1) {
                this.context.scale(
                    $.pixelDensityRatio,
                    $.pixelDensityRatio
                );
            }

            this.context.drawImage(
                this.scanvas,
                -offsetX / highTileRatio,
                -offsetY / highTileRatio,
                this.scanvas.width / highTileRatio,
                this.scanvas.height / highTileRatio
            );
            this.context.restore();
        }

        // only call tile drawn callback once the tile is actually drawn to the base canvas
        // which isn't until the this.context.drawImage call above
        if (this.viewer) {
            for (const idx in tiledImages) {
                const tiledImage = tiledImages[idx];
                const imageTiles = imageTilesList[idx];
                for (const tile of imageTiles) {
                    /**
                     * Raised when a tile is drawn to the canvas. Only valid for
                     * context2d and html drawers.
                     *
                     * @event tile-drawn
                     * @memberof OpenSeadragon.Viewer
                     * @type {object}
                     * @property {OpenSeadragon.Viewer} eventSource - A reference to the Viewer which raised the event.
                     * @property {OpenSeadragon.TiledImage} tiledImage - Which TiledImage is being drawn.
                     * @property {OpenSeadragon.Tile} tile
                     * @property {?Object} userData - Arbitrary subscriber-defined object.
                     */
                    this.viewer.raiseEvent("tile-drawn", {
                        tiledImage: tiledImage,
                        tile: tile,
                    });
                }

                this._drawDebugInfo(tiledImage, imageTiles);

                // Fire tiled-image-drawn event.
                this._raiseTiledImageDrawnEvent(tiledImage, imageTiles);
            }
        }
    }

    /**
     * @returns {Boolean} True - rotation is supported.
     */
    canRotate() {
        return true;
    }

    /**
     * Destroy the drawer (unload current loaded tiles)
     */
    destroy() {
        //force unloading of current canvas (1x1 will be gc later, trick not necessarily needed)
        this.canvas.width = 1;
        this.canvas.height = 1;
        this.scanvas = null;
        this.scontext = null;
        this.container.removeChild(this.canvas);
    }

    /**
     * @param {TiledImage} tiledImage the tiled image that is calling the function
     * @returns {Boolean} Whether this drawer requires enforcing minimum tile overlap to avoid showing seams.
     * @private
     */
    minimumOverlapRequired(tiledImage) {
        return false;
    }

    /**
     * Turns image smoothing on or off for this viewer. Note: Ignored in some (especially older) browsers that do not support this property.
     *
     * @function
     * @param {Boolean} [imageSmoothingEnabled] - Whether or not the image is
     * drawn smoothly on the canvas; see imageSmoothingEnabled in
     * {@link OpenSeadragon.Options} for more explanation.
     */
    setImageSmoothingEnabled(imageSmoothingEnabled) {
        this._imageSmoothingEnabled = !!imageSmoothingEnabled;
        this._updateImageSmoothingEnabled(this.context);
        this._updateImageSmoothingEnabled(this.scontext);
        this.viewer.forceRedraw();
    }

    /**
     * Draw a rectangle onto the canvas
     * @param {OpenSeadragon.Rect} rect
     */
    drawDebuggingRect(rect) {
        // return
        var context = this.context;
        context.save();
        context.lineWidth = 2 * $.pixelDensityRatio;
        context.strokeStyle = this.debugGridColor[0];
        context.fillStyle = this.debugGridColor[0];

        context.strokeRect(
            rect.x * $.pixelDensityRatio,
            rect.y * $.pixelDensityRatio,
            rect.width * $.pixelDensityRatio,
            rect.height * $.pixelDensityRatio
        );

        context.restore();
    }

    /**
     * Fires the tile-drawing event.
     * @private
     */
    _raiseTileDrawingEvent(tiledImage, context, tile, rendered) {
        /**
         * This event is fired just before the tile is drawn giving the application a chance to alter the image.
         *
         * NOTE: This event is only fired when the 'canvas' drawer is being used
         *
         * @event tile-drawing
         * @memberof OpenSeadragon.Viewer
         * @type {object}
         * @property {OpenSeadragon.Viewer} eventSource - A reference to the Viewer which raised the event.
         * @property {OpenSeadragon.Tile} tile - The Tile being drawn.
         * @property {OpenSeadragon.TiledImage} tiledImage - Which TiledImage is being drawn.
         * @property {CanvasRenderingContext2D} context - The HTML canvas context being drawn into.
         * @property {CanvasRenderingContext2D} rendered - The HTML canvas context containing the tile imagery.
         * @property {?Object} userData - Arbitrary subscriber-defined object.
         */
        this.viewer.raiseEvent("tile-drawing", {
            tiledImage: tiledImage,
            context: context,
            tile: tile,
            rendered: rendered,
        });
    }

    /**
     * Clears the Drawer so it's ready to draw another frame.
     * @private
     *
     */
    _prepareNewFrame() {
        var viewportSize = this._calculateCanvasSize();
        if (
            this.canvas.width !== viewportSize.x ||
            this.canvas.height !== viewportSize.y
        ) {
            this.canvas.width = viewportSize.x;
            this.canvas.height = viewportSize.y;
        }
        this._clear();
    }

    /**
     * @private
     * @param {Boolean} useSketch Whether to clear sketch canvas or main canvas
     * @param {OpenSeadragon.Rect} [bounds] The rectangle to clear
     */
    _clear(bounds) {
        var context = this.context;
        if (bounds) {
            context.clearRect(
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height
            );
        } else {
            var canvas = context.canvas;
            context.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    _roundIfNearInt(x) {
        const rx = Math.round(x);
        return Math.abs(rx - x) < 1e-4 ? rx : x;
    }
    /**
     * Draws a particular layer of a tiledImage
     * @private
     */
    _drawTilesOnSameLevel(
        tilesOnLayer,
        scale,
        offsetX,
        offsetY,
        tiledImage
    ) {
        const maxDrawScale = Math.max(
            ...tilesOnLayer.map(
                (tile) => tile.size.x / tile.sourceBounds.width
            )
        );

        for (const tile of tilesOnLayer) {
            const imgRecord = tiledImage._tileCache.getImageRecord(tile.cacheKey);
            if (!imgRecord) {
                continue;
            }
            const rendered = imgRecord.getData();
            if (!rendered) {
                continue;
            }
            // NOTE: in openseadragon 6+ you should call this inseta
            // const rendered = this.getDataToDraw(tile);
            // should be called before image is drawn to give
            // user a chance to modify the image
            // this._raiseTileDrawingEvent(tiledImage, this.context, tile, rendered);
            // these should all be basically integers since they just
            // invert the scaling/translation that has already been applied to the position
            // to converge back to an integer
            const dx = tile.position.x * scale + offsetX;
            const dy = tile.position.y * scale + offsetY;
            const dwidth = tile.sourceBounds.width * maxDrawScale * scale;
            const dheight = tile.sourceBounds.height * maxDrawScale * scale;
            // rounding them to exact integers to allow the code to take
            // faster integer based paths
            // https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas#avoid_floating-point_coordinates_and_use_integers_instead
            const rdx = this._roundIfNearInt(dx);
            const rdy = this._roundIfNearInt(dy);
            const rdwidth = this._roundIfNearInt(dwidth);
            const rdheight = this._roundIfNearInt(dheight);
            // these indicate that the formulas used to draw are just plain wrong
            // and will tend to produce incorrect results/tiling artifacts
            // important to catch errors
            if (
                // rightmost and bottommost tiles are expected to have
                // misalignments with the grid scale
                !(tile.isRightMost || tile.isBottomMost) &&
                (Math.abs(rdx - dx) > 0.1 ||
                    Math.abs(rdy - dy) > 0.1 ||
                    Math.abs(rdwidth - dwidth) > 0.1 ||
                    Math.abs(rdheight - dheight) > 0.1)
            ) {
                console.error(
                    "Rounding not stable--could produce white lines: ",
                    dx,
                    dy,
                    dwidth,
                    dheight,
                    rdx,
                    rdy,
                    rdwidth,
                    rdheight,
                    tile
                );
            }
            this.scontext.save();
            if (tile.opacity || tile.opacity === 0) {
                this.scontext.globalAlpha = tile.opacity;
            }
            this.scontext.drawImage(
                rendered,
                0,
                0,
                tile.sourceBounds.width,
                tile.sourceBounds.height,
                // using rounded dest values to make sure the GPU aliases right
                rdx,
                rdy,
                rdwidth,
                rdheight
            );
            this.scontext.restore();
        }
    }

    /**
     * Draws a TiledImage.Math
     * @private
     *
     */
    _drawTiles(tiledImage, tilesToDraw, offsetX, offsetY, highTileRatio) {
        if (tiledImage.opacity === 0 || tilesToDraw.length === 0) {
            return;
        }
        let levelSet = Array.from(
            new Set(tilesToDraw.map((tile) => tile.level))
        );
        levelSet.sort((a, b) => +a - +b);
        for (let level of levelSet) {
            let levelTiles = tilesToDraw.filter(
                (tile) => tile.level === level
            );
            this._drawTilesOnSameLevel(
                levelTiles,
                highTileRatio,
                offsetX,
                offsetY,
                tiledImage
            );
        }
    }

    /**
     * Draws special debug information for a TiledImage if in debug mode.
     * @private
     * @param {OpenSeadragon.Tile[]} tilesToDraw - An unordered list of Tiles drawn last frame.
     */
    _drawDebugInfo(tiledImage, tilesToDraw) {
        if (tiledImage.debugMode) {
            for (var i = tilesToDraw.length - 1; i >= 0; i--) {
                var tile = tilesToDraw[i];
                try {
                    this._drawDebugInfoOnTile(
                        tile,
                        tilesToDraw.length,
                        i,
                        tiledImage
                    );
                } catch (e) {
                    $.console.error(e);
                }
            }
        }
    }

    // private
    _drawDebugInfoOnTile(tile, count, i, tiledImage) {
        var colorIndex =
            this.viewer.world.getIndexOfItem(tiledImage) %
            this.debugGridColor.length;
        var context = this.context;
        context.save();
        context.lineWidth = 2 * $.pixelDensityRatio;
        context.font =
            "small-caps bold " + 13 * $.pixelDensityRatio + "px arial";
        context.strokeStyle = this.debugGridColor[colorIndex];
        context.fillStyle = this.debugGridColor[colorIndex];

        this._setRotations(tiledImage);

        if (this.viewer.viewport.getFlip()) {
            this._flip({ point: tile.position.plus(tile.size.divide(2)) });
        }

        context.strokeRect(
            tile.position.x * $.pixelDensityRatio,
            tile.position.y * $.pixelDensityRatio,
            tile.size.x * $.pixelDensityRatio,
            tile.size.y * $.pixelDensityRatio
        );

        var tileCenterX =
            (tile.position.x + tile.size.x / 2) * $.pixelDensityRatio;
        var tileCenterY =
            (tile.position.y + tile.size.y / 2) * $.pixelDensityRatio;

        // Rotate the text the right way around.
        context.translate(tileCenterX, tileCenterY);
        const angleInDegrees = this.viewport.getRotation(true);
        context.rotate((Math.PI / 180) * -angleInDegrees);
        context.translate(-tileCenterX, -tileCenterY);

        if (tile.x === 0 && tile.y === 0) {
            context.fillText(
                "Zoom: " + this.viewport.getZoom(),
                tile.position.x * $.pixelDensityRatio,
                (tile.position.y - 30) * $.pixelDensityRatio
            );
            context.fillText(
                "Pan: " + this.viewport.getBounds().toString(),
                tile.position.x * $.pixelDensityRatio,
                (tile.position.y - 20) * $.pixelDensityRatio
            );
        }
        context.fillText(
            "Level: " + tile.level,
            (tile.position.x + 10) * $.pixelDensityRatio,
            (tile.position.y + 20) * $.pixelDensityRatio
        );
        context.fillText(
            "Column: " + tile.x,
            (tile.position.x + 10) * $.pixelDensityRatio,
            (tile.position.y + 30) * $.pixelDensityRatio
        );
        context.fillText(
            "Row: " + tile.y,
            (tile.position.x + 10) * $.pixelDensityRatio,
            (tile.position.y + 40) * $.pixelDensityRatio
        );
        context.fillText(
            "Order: " + i + " of " + count,
            (tile.position.x + 10) * $.pixelDensityRatio,
            (tile.position.y + 50) * $.pixelDensityRatio
        );
        context.fillText(
            "Size: " + tile.size.toString(),
            (tile.position.x + 10) * $.pixelDensityRatio,
            (tile.position.y + 60) * $.pixelDensityRatio
        );
        context.fillText(
            "Position: " + tile.position.toString(),
            (tile.position.x + 10) * $.pixelDensityRatio,
            (tile.position.y + 70) * $.pixelDensityRatio
        );

        if (this.viewport.getRotation(true) % 360 !== 0) {
            this._restoreRotationChanges();
        }
        if (tiledImage.getRotation(true) % 360 !== 0) {
            this._restoreRotationChanges();
        }

        context.restore();
    }

    // private
    _updateImageSmoothingEnabled(context) {
        context.msImageSmoothingEnabled = this._imageSmoothingEnabled;
        context.imageSmoothingEnabled = this._imageSmoothingEnabled;
    }

    /**
     * Get the canvas center
     * @private
     * @param {Boolean} sketch If set to true return the center point of the sketch canvas
     * @returns {OpenSeadragon.Point} The center point of the canvas
     */
    _getCanvasCenter() {
        return new $.Point(this.canvas.width / 2, this.canvas.height / 2);
    }

    /**
     * Set rotations for viewport & tiledImage
     * @private
     * @param {OpenSeadragon.TiledImage} tiledImage
     * @param {Boolean} [useSketch=false]
     */
    _setRotations(tiledImage, useSketch = false) {
        var saveContext = false;
        if (this.viewport.getRotation(true) % 360 !== 0) {
            this._offsetForRotation({
                degrees: this.viewport.getRotation(true),
                useSketch: useSketch,
                saveContext: saveContext,
            });
            saveContext = false;
        }
        if (tiledImage.getRotation(true) % 360 !== 0) {
            this._offsetForRotation({
                degrees: tiledImage.getRotation(true),
                point: this.viewport.pixelFromPointNoRotate(
                    tiledImage._getRotationPoint(true),
                    true
                ),
                useSketch: useSketch,
                saveContext: saveContext,
            });
        }
    }

    // private
    _offsetForRotation(options) {
        var point = options.point ?
            options.point.times($.pixelDensityRatio) :
            this._getCanvasCenter();

        var context = this.context;
        context.save();

        context.translate(point.x, point.y);
        context.rotate((Math.PI / 180) * options.degrees);
        context.translate(-point.x, -point.y);
    }

    // private
    _flip(options) {
        options = options || {};
        var point = options.point ?
            options.point.times($.pixelDensityRatio) :
            this._getCanvasCenter();
        var context = this.context;

        context.translate(point.x, 0);
        context.scale(-1, 1);
        context.translate(-point.x, 0);
    }

    // private
    _restoreRotationChanges(useSketch) {
        var context = this.context;
        context.restore();
    }

    // private
    _calculateCanvasSize() {
        var pixelDensityRatio = $.pixelDensityRatio;
        var viewportSize = this.viewport.getContainerSize();
        return {
            // canvas width and height are integers
            x: Math.round(viewportSize.x * pixelDensityRatio),
            y: Math.round(viewportSize.y * pixelDensityRatio),
        };
    }
}
$.AlignedCanvasDrawer = AlignedCanvasDrawer;
})(OpenSeadragon);
