package crimeMap

import org.junit.Test

class DBTest {
    @Test
    public void findLatestSavedYMD_test() {
        String latest = DB.findLatestSavedYMD()
        assert latest.length() == 10
        assert latest.split('-').length == 3
    }
}
