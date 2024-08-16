#!/bin/awk -f
FNR == 1 {
	serverReport = 0
	firstPeriod = ""
	needHeading = 1
}

$3 == "Server" && $4 == "Report:" {
	serverReport = 1
}

serverReport == 1 || $1 != "[" {
	next
}

$2 == "ID]" && $7 == "Lost/Total" && needHeading {
	print "# " FILENAME
	print
	needHeading = 0
}

$3 !~ "^0\\.00-" || $4 != "sec" || $12 !~ "%" {
	next
}

firstPeriod == "" && $2 ~ "^\\*?1\\]$" {
	firstPeriod = $3
}

firstPeriod != "" && $3 != firstPeriod {
	print
}

