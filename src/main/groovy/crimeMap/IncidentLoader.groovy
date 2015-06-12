package crimeMap

import groovy.transform.CompileStatic

import java.time.LocalDate

@CompileStatic
class IncidentLoader {
    static void updateThroughYesterday() {
        LocalDate todayYMD = LocalDate.now()
        String latestYMDString = DB.findLatestSavedYMD()
        LocalDate latestYMD = LocalDate.parse(latestYMDString)
        LocalDate pollDate = latestYMD.plusDays(1)
        boolean hitEmptyDate = false
        while (pollDate.isBefore(todayYMD) && !hitEmptyDate) {
            println pollDate
            List<Incident> incidents = ApdAdapter.getIncidentsForDate(pollDate)
            int size = incidents.size()
            println size
            if (size == Integer.valueOf(0)) {
                hitEmptyDate = true
            } else {
                DB.insertIncidents(incidents)
            }
            pollDate = pollDate.plusDays(1)
        }
    }

    static void main(String[] args) {
        updateThroughYesterday()
    }
}
