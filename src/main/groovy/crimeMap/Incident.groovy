package crimeMap

import groovy.transform.CompileStatic
import groovy.transform.EqualsAndHashCode
import groovy.transform.ToString
import org.bson.types.ObjectId

@ToString
@EqualsAndHashCode
@CompileStatic
class Incident {
    ObjectId _id
    int id
    String npu
    int beat
    String marker
    String neighborhood
    /** sometimes has alpha characters */
    String number
    double[] longlat
    String type
    String shift
    String location
    String reportDate

    static Incident fromAPD(Map map) {
        final double longitude = Double.parseDouble(map.longitude.toString())
        final double latitude = Double.parseDouble(map.latitude.toString())
        new Incident(
            beat: Integer.parseInt(map.beat.toString(), 10),
            id: Integer.parseInt(map.id.toString(), 10),
            // typo in data source: "loction"
            location: map.loction.toString(),
            longlat: [longitude, latitude].toArray(0d),
            marker: map.marker.toString(),
            neighborhood: map.neighborhood.toString(),
            npu: map.npu.toString(),
            number: map.number.toString(),
            reportDate: Util.slashyMDY2dashedYMD(map.reportdate.toString()),
            shift: map.shift.toString(),
            type: map.type.toString()
        )
    }

    Map toMongoMap() {
        [
            _id: _id,
            id: id,
            npu: npu,
            beat: beat,
            marker: marker,
            neighborhood: neighborhood,
            number: number,
            longlat: longlat,
            type: type,
            shift: shift,
            location: location,
            reportDate: reportDate
        ]
    }
}
