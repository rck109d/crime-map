package crimeMap

import org.junit.Test

class IncidentTest {
    @Test
    void fromAPDTest() {
        final Map<String, String> mapFromAPD = [
            beat            : "602",
            id              : "354328",
            latitude        : "33.76454",
            // NOTE the type: "loction"
            loction         : "372 MORELAND AVE NE",
            longitude       : "-84.34959",
            marker          : "green",
            neighborhood    : "Edgewood-not-really",
            npu             : "O-maybe-not",
            number          : "151382023",
            reportdate      : "05/18/2015",
            shift           : "Eve",
            type            : "LARCENY"
        ].asImmutable()
        final Incident expected = new Incident(
            _id: null,
            beat: 602,
            id: 354328,
            location: '372 MORELAND AVE NE',
            longlat: [-84.34959, 33.76454],
            marker: 'green',
            neighborhood: 'Edgewood-not-really',
            npu: 'O-maybe-not',
            number: '151382023',
            reportDate: '2015-05-18',
            shift: 'Eve',
            type: 'LARCENY'
        )
        Incident incident = Incident.fromAPD(mapFromAPD)
        assert incident == expected
    }
}
