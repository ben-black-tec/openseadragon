/*
 * OpenSeadragon.convertor (static property)
 *
 * Copyright (C) 2009 CodePlex Foundation
 * Copyright (C) 2010-2023 OpenSeadragon contributors

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

(function($){

/**
 * modified from https://gist.github.com/Prottoy2938/66849e04b0bac459606059f5f9f3aa1a
 * @private
 */
class WeightedGraph {
    constructor() {
        this.adjacencyList = {};
        this.vertices = {};
    }
    addVertex(vertex) {
        if (!this.vertices[vertex]) {
            this.vertices[vertex] = new $.PriorityQueue.Node(0, vertex);
            this.adjacencyList[vertex] = [];
            return true;
        }
        return false;
    }
    addEdge(vertex1, vertex2, weight, transform) {
        this.adjacencyList[vertex1].push({ target: this.vertices[vertex2], origin: this.vertices[vertex1], weight, transform });
    }

    /**
     * @return {{path: *[], cost: number}|undefined} cheapest path for
     */
    dijkstra(start, finish) {
        let path = []; //to return at end
        if (start === finish) {
            return {path: path, cost: 0};
        }
        const nodes = new OpenSeadragon.PriorityQueue();
        let smallestNode;
        //build up initial state
        for (let vertex in this.vertices) {
            vertex = this.vertices[vertex];
            if (vertex.value === start) {
                vertex.key = 0; //keys are known distances
                nodes.insertNode(vertex);
            } else {
                vertex.key = Infinity;
                delete vertex.index;
            }
            vertex._previous = null;
        }
        // as long as there is something to visit
        while (nodes.getCount() > 0) {
            smallestNode = nodes.remove();
            if (smallestNode.value === finish) {
                break;
            }
            const neighbors = this.adjacencyList[smallestNode.value];
            for (let neighborKey in neighbors) {
                let edge = neighbors[neighborKey];
                //relax node
                let newCost = smallestNode.key + edge.weight;
                let nextNeighbor = edge.target;
                if (newCost < nextNeighbor.key) {
                    nextNeighbor._previous = smallestNode;
                    //key change
                    nodes.decreaseKey(nextNeighbor, newCost);
                }
            }
        }

        if (!smallestNode || !smallestNode._previous) {
            return undefined; //no path
        }

        let finalCost = smallestNode.key; //final weight last node

        // done, build the shortest path
        while (smallestNode._previous) {
            //backtrack
            const to = smallestNode.value,
                parent = smallestNode._previous,
                from = parent.value;

            path.push(this.adjacencyList[from].find(x => x.target.value === to));
            smallestNode = parent;
        }

        return {
            path: path.reverse(),
            cost: finalCost
        };
    }
}

/**
 * Node on the conversion path in OpenSeadragon.converter.getConversionPath().
 *  It can be also conversion to undefined if used as destructor implementation.
 *
 * @callback TypeConvertor
 * @memberof OpenSeadragon
 * @param {?} data data in the input format
 * @return {?} data in the output format
 */

/**
 * Node on the conversion path in OpenSeadragon.converter.getConversionPath().
 *
 * @typedef {Object} ConversionStep
 * @memberof OpenSeadragon
 * @param {OpenSeadragon.PriorityQueue.Node} target - Target node of the conversion step.
 *  Its value is the target format.
 * @param {OpenSeadragon.PriorityQueue.Node} origin - Origin node of the conversion step.
 *  Its value is the origin format.
 * @param {number} weight cost of the conversion
 * @param {TypeConvertor} transform the conversion itself
 */

/**
 * Class that orchestrates automated data types conversion. Do not instantiate
 * this class, use OpenSeadragon.convertor - a global instance, instead.
 * @class DataTypeConvertor
 * @memberOf OpenSeadragon
 */
$.DataTypeConvertor = class {

    constructor() {
        this.graph = new WeightedGraph();
        this.destructors = {};

        // Teaching OpenSeadragon built-in conversions:

        this.learn("canvas", "rasterUrl", (canvas) => canvas.toDataURL(), 1, 1);
        this.learn("image", "rasterUrl", (image) => image.url);
        this.learn("canvas", "context2d", (canvas) => canvas.getContext("2d"));
        this.learn("context2d", "canvas", (context2D) => context2D.canvas);
        this.learn("image", "canvas", (image) => {
            const canvas = document.createElement( 'canvas' );
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d');
            context.drawImage( image, 0, 0 );
            return canvas;
        }, 1, 1);
        this.learn("rasterUrl", "image", (url) => {
            return new $.Promise((resolve, reject) => {
                const img = new Image();
                img.onerror = img.onabort = reject;
                img.onload = () => resolve(img);
                img.src = url;
            });
        }, 1, 1);
    }

    /**
     * FIXME: types are sensitive thing. Same data type might have different data semantics.
     *  - 'string' can be anything, for images, dataUrl or some URI, or incompatible stuff: vector data (JSON)
     *  - using $.type makes explicit requirements on its extensibility, and makes mess in naming
     *    - most types are [object X]
     *    - selected types are 'nice' -> string, canvas...
     *    - hard to debug
     *
     * Unique identifier (unlike toString.call(x)) to be guessed
     * from the data value
     *
     * @function uniqueType
     * @param x object to get unique identifier for
     *  - can be array, in that case, alphabetically-ordered list of inner unique types
     *    is returned (null, undefined are ignored)
     *  - if $.isPlainObject(x) is true, then the object can define
     *    getType function to specify its type
     *  - otherwise, toString.call(x) is applied to get the parameter description
     * @return {string} unique variable descriptor
     */
    guessType( x ) {
        if (Array.isArray(x)) {
            const types = [];
            for (let item of x) {
                if (item === undefined || item === null) {
                    continue;
                }

                const type = this.guessType(item);
                if (!types.includes(type)) {
                    types.push(type);
                }
            }
            types.sort();
            return `Array [${types.join(",")}]`;
        }

        const guessType = $.type(x);
        if (guessType === "dom-node") {
            //distinguish nodes
            return guessType.nodeName.toLowerCase();
        }

        if (guessType === "object") {
            if ($.isFunction(x.getType)) {
                return x.getType();
            }
        }
        return guessType;
    }

    /**
     * Teach the system to convert data type 'from' -> 'to'
     * @param {string} from unique ID of the data item 'from'
     * @param {string} to unique ID of the data item 'to'
     * @param {OpenSeadragon.TypeConvertor} callback convertor that takes type 'from', and converts to type 'to'.
     *  Callback can return function. This function returns the data in type 'to',
     *  it can return also the value wrapped in a Promise (returned in resolve) or it can be async function.
     * @param {Number} [costPower=0] positive cost class of the conversion, smaller or equal than 7.
     *   Should reflect the actual cost of the conversion:
     *   - if nothing must be done and only reference is retrieved (or a constant operation done),
     *     return 0 (default)
     *   - if a linear amount of work is necessary,
     *     return 1
     *   ... and so on, basically the number in O() complexity power exponent (for simplification)
     * @param {Number} [costMultiplier=1] multiplier of the cost class, e.g. O(3n^2) would
     *   use costPower=2, costMultiplier=3; can be between 1 and 10^5
     */
    learn(from, to, callback, costPower = 0, costMultiplier = 1) {
        $.console.assert(costPower >= 0 && costPower <= 7, "[DataTypeConvertor] Conversion costPower must be between <0, 7>.");
        $.console.assert($.isFunction(callback), "[DataTypeConvertor:learn] Callback must be a valid function!");

        //we won't know if somebody added multiple edges, though it will choose some edge anyway
        costPower++;
        costMultiplier = Math.min(Math.max(costMultiplier, 1), 10 ^ 5);
        this.graph.addVertex(from);
        this.graph.addVertex(to);
        this.graph.addEdge(from, to, costPower * 10 ^ 5 + costMultiplier, callback);
        this._known = {}; //invalidate precomputed paths :/
    }

    /**
     * Teach the system to destroy data type 'type'
     * for example, textures loaded to GPU have to be also manually removed when not needed anymore.
     * Needs to be defined only when the created object has extra deletion process.
     * @param {string} type
     * @param {OpenSeadragon.TypeConvertor} callback destructor, receives the object created,
     *   it is basically a type conversion to 'undefined' - thus the type.
     */
    learnDestroy(type, callback) {
        this.destructors[type] = callback;
    }

    /**
     * Convert data item x of type 'from' to any of the 'to' types, chosen is the cheapest known conversion.
     * Data is destroyed upon conversion. For different behavior, implement your conversion using the
     * path rules obtained from getConversionPath().
     * @param {*} x data item to convert
     * @param {string} from data item type
     * @param {string} to desired type(s)
     * @return {OpenSeadragon.Promise<?>} promise resolution with type 'to' or undefined if the conversion failed
     */
    convert(x, from, ...to) {
        const conversionPath = this.getConversionPath(from, to);
        if (!conversionPath) {
            $.console.error(`[OpenSeadragon.convertor.convert] Conversion conversion ${from} ---> ${to} cannot be done!`);
            return $.Promise.resolve();
        }

        const stepCount = conversionPath.length,
            _this = this;
        const step = (x, i) => {
            if (i >= stepCount) {
                return $.Promise.resolve(x);
            }
            let edge = conversionPath[i];
            let y = edge.transform(x);
            if (!y) {
                $.console.warn(`[OpenSeadragon.convertor.convert] data mid result falsey value (while converting to %s)`, edge.target);
                return $.Promise.resolve();
            }
            //node.value holds the type string
            _this.destroy(edge.origin.value, x);
            const result = $.type(y) === "promise" ? y : $.Promise.resolve(y);
            return result.then(res => step(res, i + 1));
        };
        return step(x, 0);
    }

    /**
     * Destroy the data item given.
     * @param {string} type data type
     * @param {?} data
     */
    destroy(type, data) {
        const destructor = this.destructors[type];
        if (destructor) {
            destructor(data);
        }
    }

    /**
     * Get possible system type conversions and cache result.
     * @param {string} from data item type
     * @param {string|string[]} to array of accepted types
     * @return {[ConversionStep]|undefined} array of required conversions (returns empty array
     *  for from===to), or undefined if the system cannot convert between given types.
     *  Each object has 'transform' function that converts between neighbouring types, such
     *  that x = arr[i].transform(x) is valid input for convertor arr[i+1].transform(), e.g.
     *  arr[i+1].transform(arr[i].transform( ... )) is a valid conversion procedure.
     *
     *  Note: if a function is returned, it is a callback called once the data is ready.
     */
    getConversionPath(from, to) {
        let bestConvertorPath, selectedType;
        let knownFrom = this._known[from];
        if (!knownFrom) {
            this._known[from] = knownFrom = {};
        }

        if (Array.isArray(to)) {
            $.console.assert(typeof to === "string" || to.length > 0, "[getConversionPath] conversion 'to' type must be defined.");
            let bestCost = Infinity;

            //FIXME: pre-compute all paths in 'to' array? could be efficient for multiple
            // type system, but overhead for simple use cases... now we just use the first type if costs unknown
            selectedType = to[0];

            for (const outType of to) {
                const conversion = knownFrom[outType];
                if (conversion && bestCost > conversion.cost) {
                    bestConvertorPath = conversion;
                    bestCost = conversion.cost;
                    selectedType = outType;
                }
            }
        } else {
            $.console.assert(typeof to === "string", "[getConversionPath] conversion 'to' type must be defined.");
            bestConvertorPath = knownFrom[to];
            selectedType = to;
        }

        if (!bestConvertorPath) {
            bestConvertorPath = this.graph.dijkstra(from, selectedType);
            this._known[from][selectedType] = bestConvertorPath;
        }
        return bestConvertorPath ? bestConvertorPath.path : undefined;
    }
};

/**
 * Static convertor available throughout OpenSeadragon.
 *
 * Built-in conversions include types:
 *  - context2d    canvas 2d context
 *  - image        HTMLImage element
 *  - rasterUrl    url string carrying or pointing to 2D raster data
 *  - canvas       HTMLCanvas element
 *
 * @type OpenSeadragon.DataTypeConvertor
 * @memberOf OpenSeadragon
 */
$.convertor = new $.DataTypeConvertor();

}(OpenSeadragon));
