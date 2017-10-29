import Vector from "./Vector";
import ConvexPolygon from "./ConvexPolygon";
import Range from "./Range";

export default class Physics {
    constructor(tilemapJson) {
        this.tilemapJson = tilemapJson;
        this.shapes = [];
    }

    enableObjectLayer(objectLayerName) {
        const objectLayerJson = this.tilemapJson.layers.find(layer => layer.type === "objectgroup" && layer.name === objectLayerName);
        if (!objectLayerJson) {
            throw new Error(`No object layer found with name "${objectLayerName}"`);
        }

        this.shapes = [];
        for (const objectJson of objectLayerJson.objects) {
            if (objectJson.polygon) {
                this.addPolygon(objectJson);
            } else if (objectJson.polyline) {
                // ignore poly line
            } else if (objectJson.ellipse) {
                // ignore ellipse
            } else if (objectJson.gid) {
                // ignore tile
            } else if (objectJson.text) {
                // ignore text
            } else { // rectangle
                this.addRectangle(objectJson);
            }
        }
    }

    collideWith(sprite) {
        const body = sprite.body;
        const gravity = sprite.game.physics.arcade.gravity;
        const gravityVector = new Vector(gravity.x, gravity.y);
        const gravityNormal = gravityVector.normalized();
        const velocity = new Vector(body.velocity.x, body.velocity.y);
        
        if (!body.contactNormal) {
            body.contactNormal = new Vector();            
        }
        body.contactNormal.x = body.contactNormal.y = 0;
        for (const shape of this.shapes) {
            const collision = shape.collideWidth(body);
            if (collision) {
                const penetration = collision.penetration;
                const normal = collision.normal;
                body.contactNormal = body.contactNormal.plus(normal);
                
                // resolve penetration
                body.x -= penetration.x;
                body.y -= penetration.y;

                // additional unit in direction of normal prevents sprite from
                // falling between vertical seams
                body.x += normal.x;
                body.y += normal.y;

                // if moving away, no resitution to compute
                const speedNormal = velocity.dot(normal);
                if (speedNormal >= 0) {
                    continue;
                }
                    
                // decompose old velocity into normal and tangent components
                const velocityNormal = normal.scale(speedNormal);
                const velocityTangent = velocity.minus(velocityNormal);

                // compute restitution on normal component
                let newVelocityNormal;
                const bounce = shape.properties && shape.properties.bounce;
                if (bounce && penetration.length() > 2) {
                    newVelocityNormal = velocityNormal.scale(-bounce);
                } else {
                    newVelocityNormal = new Vector();                    
                }

                // todo: compute friction on tangent component                
                const newVelocityTangent = velocityTangent;
                
                const newVelocity = newVelocityNormal.plus(newVelocityTangent);

                body.velocity.x = newVelocity.x;
                body.velocity.y = newVelocity.y;

                // prevent sprites sticking in adjacent shapes
                if (normal.dot(gravityVector) < 0) {
                    body.x -= gravityNormal.x;
                    body.y -= gravityNormal.y;
                }
            }
        }
        body.contactNormal = body.contactNormal.normalized();
    }

    addRectangle(objectJson) {
        // convert to convex polygon
        const width = objectJson.width;
        const height = objectJson.height;
        let widthVector = new Vector(width, 0);
        let heightVector = new Vector(0, height);
        // handle box rotation
        const angle = -objectJson.rotation * Math.PI / 180;
        if (angle) {
            widthVector = widthVector.rotated(angle);
            heightVector = heightVector.rotated(angle);
        }
        const polygonJson = {
            x: objectJson.x,
            y: objectJson.y,
            width: objectJson.width,
            height: objectJson.height,
            polygon: [{x: 0, y: 0}, widthVector, widthVector.plus(heightVector), heightVector],
            properties: objectJson.properties
        };
        this.addPolygon(polygonJson);
    }

    addPolygon(objectJson) {
        const vertices = objectJson.polygon.map(
            point => new Vector(objectJson.x + point.x, objectJson.y + point.y)
        );
        const convexPolygons = ConvexPolygon.generateConvexPolygons(vertices);
        for (const convexPolygon of convexPolygons) {
            this.addConvexPolygon(convexPolygon, objectJson.properties);
        }
    }

    addConvexPolygon(convexPolygon, properties) {
        let left = Number.POSITIVE_INFINITY;
        let top = Number.POSITIVE_INFINITY;
        let right = Number.NEGATIVE_INFINITY;
        let bottom = Number.NEGATIVE_INFINITY;
        for (const vertex of convexPolygon.vertices) {
            left = Math.min(left, vertex.x);
            top = Math.min(left, vertex.y);
            right = Math.max(left, vertex.x);
            bottom = Math.max(left, vertex.y);
        }
        
        const shape = {            
            type: "polygon",
            left,
            top,
            right,
            bottom,
            polygon: convexPolygon,
            properties: properties,
            collideWidth: function(body) {
                const bodyLeft = body.x;
                const bodyRight = body.x + body.width;
                const bodyTop = body.y;
                const bodyBottom = body.y + body.height;

                // sat axes - 2 ortho axis normals and object poly normals
                // first 2 normals prune search when sprite out of object bounding box
                const axes = [new Vector(1, 0), new Vector(0, 1)].concat(this.polygon.normals);

                const spritePolygon = ConvexPolygon.fromRectangle(bodyLeft, bodyTop, bodyRight, bodyBottom);

                let minPenetration = Number.POSITIVE_INFINITY;
                let minNormal;
                for (const axis of axes) {
                    const objectRange = this.polygon.projectOntoAxis(axis);
                    const spriteRange = spritePolygon.projectOntoAxis(axis);
                    const intersection = Range.intersection(objectRange, spriteRange);
                    if (intersection.isEmpty()) {
                        return null;
                    }

                    // intersection.length() not good enough for small objects
                    // need to compute min of two potential penetrations from opposite sides
                    let penetration = Math.min(
                        Math.abs(objectRange.max - spriteRange.min),
                        Math.abs(spriteRange.max - objectRange.min));
                    if (minPenetration > penetration) {
                        minPenetration = penetration;
                        minNormal = axis;
                    }
                }
                
                // ensure normal pointing towards sprite
                const spriteOffset = spritePolygon.centre.minus(this.polygon.centre);
                if (spriteOffset.dot(minNormal) < 0) {
                    minNormal = minNormal.scale(-1);
                }

                const collision = {
                    penetration: minNormal.scale(-minPenetration),
                    normal: minNormal
                };

                return collision;
            }
        };
        this.shapes.push(shape);
    }
}