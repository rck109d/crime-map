package crimeMap

import com.gmongo.GMongoClient
import com.mongodb.DBObject

class DB {
    static GMongoClient mongoClient = new GMongoClient()
    static db = mongoClient.getDB('crime')
    static incidents = db.getCollection('incidents')

    static String findLatestSavedYMD() {
        Map query = [:]
        Map fields = [
                _id       : 0,
                reportDate: 1
        ]
        Map orderBy = [
                reportDate: -1
        ]
        DBObject dbo = incidents.findOne(query, fields, orderBy)
        return dbo?.reportDate
    }

    static void insertIncidents(List<Incident> newIncidents) {
        List<Map> maps = newIncidents*.toMongoMap()
        incidents.insert(maps)
    }
}
