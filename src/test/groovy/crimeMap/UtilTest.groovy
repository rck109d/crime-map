package crimeMap

import org.junit.Test

import java.time.LocalDate

class UtilTest {
  @Test
  public void dashyYMD2slashyMDY_Test() {
    assert Util.localDate2slashyMDY(LocalDate.of(2015, 3, 27)) == '03/27/2015'
  }
  @Test
  public void slashyMDY2dashedYMD_Test() {
    assert Util.slashyMDY2dashedYMD('03/27/2015') == '2015-03-27'
  }
}
