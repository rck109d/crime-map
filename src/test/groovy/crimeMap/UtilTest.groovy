package crimeMap

import org.junit.Test

class UtilTest {
  @Test
  public void dashyYMD2slashyMDY_Test() {
    assert Util.dashyYMD2slashyMDY('2015-03-27') == '03/27/2015'
  }
}
